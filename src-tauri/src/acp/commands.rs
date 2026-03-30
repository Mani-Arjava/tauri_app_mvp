use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use agent_client_protocol::{
    Agent, CancelNotification, ClientCapabilities, ClientSideConnection, ContentBlock,
    InitializeRequest, NewSessionRequest, PromptRequest, ProtocolVersion, TextContent,
};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot};

use super::client::TauriAcpClient;
use super::state::{AcpInner, AcpState, SessionCommand, SINGLE_SESSION_KEY};
use super::types::{AcpDisconnectedEvent, ChatChunkEvent};

// ─── Shared init/prompt/shutdown logic ───────────────────────────────────────

/// Spawn a new ACP session on a dedicated background thread and store it under `session_key`.
/// No-op if a session with this key already exists.
async fn do_acp_init(
    session_key: String,
    mcp_servers: Option<Vec<Value>>,
    model: Option<String>,
    cwd: Option<String>,
    state: &AcpState,
    app: &AppHandle,
) -> Result<(), String> {
    // Prevent double-init for this session key
    {
        let guard = state.sessions.read().await;
        if guard.contains_key(&session_key) {
            return Ok(());
        }
    }

    // Write settings to {cwd}/.claude/settings.local.json before spawning.
    //
    // Two things are written:
    //   1. permissions.allow — broad allowlist so Claude Code's PreToolUse hooks don't
    //      block file operations or bash commands.
    //   2. mcpServers — ACP@0.1.1 rejects non-empty mcpServers in session/new (-32600),
    //      so we register them via the settings file instead.
    let resolved_cwd = cwd
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| "/tmp".to_string())
        });

    {
        let cwd_path = std::path::PathBuf::from(&resolved_cwd);
        let claude_dir = cwd_path.join(".claude");
        let settings_path = claude_dir.join("settings.local.json");

        let mut settings: serde_json::Map<String, Value> = settings_path
            .exists()
            .then(|| std::fs::read_to_string(&settings_path).ok())
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        settings.insert(
            "permissions".to_string(),
            serde_json::json!({
                "allow": [
                    "Bash(*)", "Write(*)", "Edit(*)", "Read(*)", "Glob(*)", "Grep(*)", "MultiEdit(*)"
                ]
            }),
        );

        if let Some(servers) = &mcp_servers {
            if !servers.is_empty() {
                let mut mcp_obj = serde_json::Map::new();
                for server in servers {
                    if let Some(name) = server.get("name").and_then(|v| v.as_str()) {
                        let mut entry = serde_json::Map::new();
                        entry.insert("type".to_string(), Value::String("stdio".to_string()));
                        if let Some(cmd_str) = server.get("command").and_then(|v| v.as_str()) {
                            entry.insert("command".to_string(), Value::String(cmd_str.to_string()));
                        }
                        if let Some(args) = server.get("args").and_then(|v| v.as_array()) {
                            entry.insert("args".to_string(), Value::Array(args.clone()));
                        }
                        if let Some(env) = server.get("env").and_then(|v| v.as_object()) {
                            if !env.is_empty() {
                                entry.insert("env".to_string(), Value::Object(env.clone()));
                            }
                        }
                        mcp_obj.insert(name.to_string(), Value::Object(entry));
                    }
                }
                settings.insert("mcpServers".to_string(), Value::Object(mcp_obj));
            }
        }

        if let Ok(json) = serde_json::to_string_pretty(&Value::Object(settings)) {
            let _ = std::fs::create_dir_all(&claude_dir);
            let _ = std::fs::write(&settings_path, json);
        }
    }

    // Channel: main runtime → background thread (commands)
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<SessionCommand>(8);
    // Channel: background thread → main runtime (setup result: session_id or error)
    let (setup_tx, setup_rx) = oneshot::channel::<Result<String, String>>();

    let is_running = Arc::new(AtomicBool::new(true));
    let is_running_clone = Arc::clone(&is_running);

    let session_key_clone = session_key.clone();
    let app_clone = app.clone();
    let resolved_cwd_clone = resolved_cwd.clone();
    let model_clone = model.clone();

    // These are used AFTER rt.block_on() exits for the disconnect event.
    let app_for_disconnect = app_clone.clone();
    let session_key_for_disconnect = session_key_clone.clone();

    // Spawn a dedicated OS thread for this session.
    // The thread runs its own single-threaded tokio runtime + LocalSet so that
    // ClientSideConnection's internal !Send background tasks can use spawn_local.
    let thread = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build session tokio runtime");

        let local = tokio::task::LocalSet::new();

        rt.block_on(local.run_until(async move {
            // ── Spawn child process inside this runtime ──
            let preload = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("acp-preload.cjs");

            let mut cmd = tokio::process::Command::new("npx");
            cmd.arg("claude-code-acp")
                .env("NODE_OPTIONS", format!("--require {}", preload.display()))
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit());

            if let Some(m) = model_clone.as_deref().filter(|s| !s.trim().is_empty()) {
                cmd.env("ANTHROPIC_MODEL", m);
            }

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = setup_tx.send(Err(format!(
                        "Failed to start claude-code-acp. Install Claude Code CLI and run \
                         'claude login'. Error: {}",
                        e
                    )));
                    return;
                }
            };

            let stdin = match child.stdin.take() {
                Some(s) => s,
                None => {
                    let _ = setup_tx.send(Err("Failed to capture agent stdin".to_string()));
                    return;
                }
            };
            let stdout = match child.stdout.take() {
                Some(s) => s,
                None => {
                    let _ = setup_tx.send(Err("Failed to capture agent stdout".to_string()));
                    return;
                }
            };

            // ── Create ClientSideConnection via the official crate ──
            let client = TauriAcpClient {
                session_key: session_key_clone.clone(),
                app: app_clone.clone(),
            };

            // Bridge tokio IO types to futures-io traits required by the crate.
            let stdin_compat = stdin.compat_write();
            let stdout_compat = stdout.compat();

            let (connection, run_loop) = ClientSideConnection::new(
                client,
                stdin_compat,
                stdout_compat,
                |fut| {
                    tokio::task::spawn_local(fut);
                },
            );

            let connection = Arc::new(connection);

            // Spawn the crate's background run loop as a local task.
            let sk_for_log = session_key_clone.clone();
            tokio::task::spawn_local(async move {
                if let Err(e) = run_loop.await {
                    eprintln!("[acp] run_loop error for {}: {}", sk_for_log, e);
                }
            });

            // ── Protocol handshake using crate's typed methods ──
            let init_req = InitializeRequest::new(ProtocolVersion::LATEST)
                .client_capabilities(ClientCapabilities::new());

            if let Err(e) = connection.initialize(init_req).await {
                let _ = setup_tx.send(Err(format!("initialize failed: {}", e)));
                let _ = child.kill().await;
                return;
            }

            let session_req = NewSessionRequest::new(resolved_cwd_clone.as_str());

            let session_result = match connection.new_session(session_req).await {
                Ok(r) => r,
                Err(e) => {
                    let _ = setup_tx.send(Err(format!("session/new failed: {}", e)));
                    let _ = child.kill().await;
                    return;
                }
            };

            let session_id = session_result.session_id.to_string();
            let session_id_for_loop = session_result.session_id.clone();

            // Send the session_id back to the main runtime so AcpInner can be stored.
            if setup_tx.send(Ok(session_id)).is_err() {
                // Main runtime dropped — clean up.
                let _ = child.kill().await;
                return;
            }

            // ── Command loop ──
            // Wait for Prompt / Cancel / Shutdown commands from the main runtime.
            loop {
                match cmd_rx.recv().await {
                    Some(SessionCommand::Prompt { message, resp }) => {
                        let prompt_req = PromptRequest::new(
                            session_id_for_loop.clone(),
                            vec![ContentBlock::Text(TextContent::new(message))],
                        );

                        let result = connection.prompt(prompt_req).await
                            .map(|_| ())
                            .map_err(|e: agent_client_protocol::Error| e.to_string());

                        // Emit done chunk so frontend knows streaming finished.
                        let _ = app_clone.emit(
                            "acp:message-chunk",
                            ChatChunkEvent {
                                session_key: session_key_clone.clone(),
                                text: String::new(),
                                done: true,
                            },
                        );

                        let _ = resp.send(result);
                    }
                    Some(SessionCommand::Cancel) => {
                        let cancel = CancelNotification::new(session_id_for_loop.clone());
                        let _ = connection.cancel(cancel).await;
                    }
                    Some(SessionCommand::Shutdown) | None => {
                        break;
                    }
                }
            }

            // ── Cleanup ──
            let _ = child.kill().await;
        }));

        // Thread is exiting — mark session as no longer running and emit disconnect event.
        is_running_clone.store(false, Ordering::Relaxed);
        let _ = app_for_disconnect.emit(
            "acp:disconnected",
            AcpDisconnectedEvent {
                session_key: session_key_for_disconnect,
            },
        );
    });

    // Wait for the background thread to complete setup (or fail).
    let session_id = setup_rx
        .await
        .map_err(|_| "Session thread exited before setup completed".to_string())??;

    let inner = AcpInner {
        cmd_tx,
        session_id,
        is_running,
        _thread: thread,
    };

    state.sessions.write().await.insert(session_key, inner);
    Ok(())
}

/// Send a prompt on an existing session and await the full response.
/// Streaming chunks flow independently via Tauri events emitted in TauriAcpClient.
async fn do_send_prompt(
    session_key: &str,
    message: String,
    state: &AcpState,
) -> Result<(), String> {
    let cmd_tx = {
        let guard = state.sessions.read().await;
        let inner = guard
            .get(session_key)
            .ok_or_else(|| format!("ACP session '{}' not found", session_key))?;
        inner.cmd_tx.clone()
    };

    let (resp_tx, resp_rx) = oneshot::channel();
    cmd_tx
        .send(SessionCommand::Prompt { message, resp: resp_tx })
        .await
        .map_err(|_| "Session thread is no longer running".to_string())?;

    resp_rx
        .await
        .map_err(|_| "Session thread dropped before prompt completed".to_string())?
}

/// Shut down and remove a session from the map.
async fn do_shutdown(session_key: &str, state: &AcpState) -> Result<(), String> {
    let mut guard = state.sessions.write().await;
    if let Some(inner) = guard.remove(session_key) {
        // Signal the background thread to exit (best effort).
        let _ = inner.cmd_tx.try_send(SessionCommand::Shutdown);
    }
    Ok(())
}

// ─── Single-agent commands (backward-compatible) ──────────────────────────────

#[tauri::command]
pub async fn acp_initialize(
    mcp_servers: Option<Vec<Value>>,
    model: Option<String>,
    cwd: Option<String>,
    state: State<'_, AcpState>,
    app: AppHandle,
) -> Result<(), String> {
    do_acp_init(SINGLE_SESSION_KEY.to_string(), mcp_servers, model, cwd, &state, &app).await
}

#[tauri::command]
pub async fn acp_send_prompt(
    message: String,
    state: State<'_, AcpState>,
    _app: AppHandle,
) -> Result<(), String> {
    do_send_prompt(SINGLE_SESSION_KEY, message, &state).await
}

#[tauri::command]
pub async fn acp_is_active(state: State<'_, AcpState>) -> Result<bool, String> {
    let guard = state.sessions.read().await;
    Ok(guard.get(SINGLE_SESSION_KEY).map_or(false, |i| i.is_alive()))
}

#[tauri::command]
pub async fn acp_cancel(state: State<'_, AcpState>) -> Result<(), String> {
    let guard = state.sessions.read().await;
    let inner = guard.get(SINGLE_SESSION_KEY).ok_or("ACP not initialized")?;
    inner
        .cmd_tx
        .send(SessionCommand::Cancel)
        .await
        .map_err(|_| "Session thread is no longer running".to_string())
}

#[tauri::command]
pub async fn acp_shutdown(state: State<'_, AcpState>) -> Result<(), String> {
    do_shutdown(SINGLE_SESSION_KEY, &state).await
}

// ─── Multi-session commands (pipeline support) ────────────────────────────────

#[tauri::command]
pub async fn acp_initialize_session(
    session_key: String,
    mcp_servers: Option<Vec<Value>>,
    model: Option<String>,
    cwd: Option<String>,
    state: State<'_, AcpState>,
    app: AppHandle,
) -> Result<(), String> {
    do_acp_init(session_key, mcp_servers, model, cwd, &state, &app).await
}

#[tauri::command]
pub async fn acp_send_prompt_session(
    session_key: String,
    message: String,
    state: State<'_, AcpState>,
    _app: AppHandle,
) -> Result<(), String> {
    do_send_prompt(&session_key, message, &state).await
}

#[tauri::command]
pub async fn acp_is_active_session(
    session_key: String,
    state: State<'_, AcpState>,
) -> Result<bool, String> {
    let guard = state.sessions.read().await;
    Ok(guard.get(&session_key).map_or(false, |i| i.is_alive()))
}

#[tauri::command]
pub async fn acp_shutdown_session(
    session_key: String,
    state: State<'_, AcpState>,
) -> Result<(), String> {
    do_shutdown(&session_key, &state).await
}
