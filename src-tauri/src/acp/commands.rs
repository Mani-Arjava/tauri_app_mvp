use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use super::reader::run_reader;
use super::state::{AcpInner, AcpState, SINGLE_SESSION_KEY};
use super::types::ChatChunkEvent;

// ─── Low-level JSON-RPC helpers ───────────────────────────────────────────────

/// Write a JSON-RPC request to stdin and return a oneshot receiver for the response.
async fn send_request(
    stdin: &Arc<Mutex<ChildStdin>>,
    pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    next_id: &AtomicU64,
    method: &str,
    params: Option<Value>,
) -> Result<oneshot::Receiver<Result<Value, String>>, String> {
    let id = next_id.fetch_add(1, Ordering::Relaxed);

    let msg = if let Some(p) = params {
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": p,
        })
    } else {
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
        })
    };

    let (tx, rx) = oneshot::channel();
    {
        let mut map = pending.lock().await;
        map.insert(id, tx);
    }

    let mut line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
    line.push('\n');

    {
        let mut stdin_guard = stdin.lock().await;
        stdin_guard
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to agent stdin: {}", e))?;
        stdin_guard
            .flush()
            .await
            .map_err(|e| format!("Failed to flush agent stdin: {}", e))?;
    }

    Ok(rx)
}

/// Write a JSON-RPC notification to stdin (no id, no response expected).
async fn send_notification(
    stdin: &Arc<Mutex<ChildStdin>>,
    method: &str,
    params: Option<Value>,
) -> Result<(), String> {
    let msg = if let Some(p) = params {
        serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": p,
        })
    } else {
        serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
        })
    };

    let mut line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
    line.push('\n');

    let mut stdin_guard = stdin.lock().await;
    stdin_guard
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Failed to write notification: {}", e))?;
    stdin_guard
        .flush()
        .await
        .map_err(|e| format!("Failed to flush notification: {}", e))?;

    Ok(())
}

// ─── Shared init/prompt/shutdown logic ───────────────────────────────────────

/// Spawn a new ACP session and store it under `session_key`.
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
    //      block file operations or bash commands (Layer 2 of Claude Code's permission system).
    //   2. mcpServers — ACP@0.1.1 rejects non-empty mcpServers in session/new (-32600),
    //      so we register them via the settings file instead.
    if let Some(ref project_cwd) = cwd {
        if !project_cwd.trim().is_empty() {
            let claude_dir = std::path::PathBuf::from(project_cwd.trim()).join(".claude");
            let settings_path = claude_dir.join("settings.local.json");

            let mut settings: serde_json::Map<String, Value> = settings_path
                .exists()
                .then(|| std::fs::read_to_string(&settings_path).ok())
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            // Always grant broad permissions so Claude can operate autonomously.
            settings.insert(
                "permissions".to_string(),
                serde_json::json!({
                    "allow": [
                        "Bash(*)",
                        "Write(*)",
                        "Edit(*)",
                        "Read(*)",
                        "Glob(*)",
                        "Grep(*)",
                        "MultiEdit(*)"
                    ]
                }),
            );

            // Write MCP servers when the agent has any configured.
            if let Some(servers) = &mcp_servers {
                if !servers.is_empty() {
                    let mut mcp_obj = serde_json::Map::new();
                    for server in servers {
                        if let Some(name) = server.get("name").and_then(|v| v.as_str()) {
                            let mut entry = serde_json::Map::new();
                            entry.insert("type".to_string(), Value::String("stdio".to_string()));
                            if let Some(cmd_str) = server.get("command").and_then(|v| v.as_str()) {
                                entry.insert(
                                    "command".to_string(),
                                    Value::String(cmd_str.to_string()),
                                );
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
    }

    let preload = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("acp-preload.cjs");
    let mut cmd = Command::new("npx");
    cmd.arg("claude-code-acp")
        .env("NODE_OPTIONS", format!("--require {}", preload.display()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    if let Some(m) = model.as_deref().filter(|s| !s.trim().is_empty()) {
        cmd.env("ANTHROPIC_MODEL", m);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to start claude-code-acp. Install Claude Code CLI and run \
             'claude login'. Error: {}",
            e
        )
    })?;

    let stdin = child
        .stdin
        .take()
        .ok_or("Failed to capture agent stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture agent stdout")?;

    let stdin = Arc::new(Mutex::new(stdin));
    let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let next_id = AtomicU64::new(1);

    // Start the background reader task — passes session_key so events are tagged
    let reader_handle = tokio::spawn(run_reader(
        session_key.clone(),
        stdout,
        Arc::clone(&stdin),
        Arc::clone(&pending),
        app.clone(),
    ));

    // Send `initialize` request
    let rx = send_request(
        &stdin,
        &pending,
        &next_id,
        "initialize",
        Some(serde_json::json!({
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": {
                "name": "agent-creator",
                "version": "0.1.0"
            }
        })),
    )
    .await?;

    rx.await
        .map_err(|_| "Reader task dropped before initialize response".to_string())?
        .map_err(|e| format!("initialize failed: {}", e))?;

    // Send `session/new` request
    let resolved_cwd = cwd
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| "/tmp".to_string())
        });

    // ACP@0.1.1 throws -32600 for non-empty mcpServers; load from settings.local.json instead.
    let rx = send_request(
        &stdin,
        &pending,
        &next_id,
        "session/new",
        Some(serde_json::json!({
            "cwd": resolved_cwd,
            "mcpServers": []
        })),
    )
    .await?;

    let session_result = rx
        .await
        .map_err(|_| "Reader task dropped before session/new response".to_string())?
        .map_err(|e| format!("session/new failed: {}", e))?;

    let session_id = session_result
        .get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or("session/new response missing sessionId")?
        .to_string();

    let inner = AcpInner {
        child,
        stdin,
        next_id,
        session_id,
        pending,
        reader_handle,
    };

    state.sessions.write().await.insert(session_key, inner);
    Ok(())
}

/// Send a prompt on an existing session and await the full response.
/// Emits `acp:message-chunk` events (tagged with session_key) while streaming.
async fn do_send_prompt(
    session_key: &str,
    message: String,
    state: &AcpState,
    app: &AppHandle,
) -> Result<(), String> {
    let (stdin, pending, request_id, session_id) = {
        let guard = state.sessions.read().await;
        let inner = guard
            .get(session_key)
            .ok_or_else(|| format!("ACP session '{}' not found", session_key))?;
        (
            Arc::clone(&inner.stdin),
            Arc::clone(&inner.pending),
            inner.next_id.fetch_add(1, Ordering::Relaxed),
            inner.session_id.clone(),
        )
    };

    let msg = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "session/prompt",
        "params": {
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": message }]
        }
    });

    let (tx, rx) = oneshot::channel();
    {
        let mut map = pending.lock().await;
        map.insert(request_id, tx);
    }

    let mut line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
    line.push('\n');

    {
        let mut stdin_guard = stdin.lock().await;
        stdin_guard
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write prompt: {}", e))?;
        stdin_guard
            .flush()
            .await
            .map_err(|e| format!("Failed to flush prompt: {}", e))?;
    }

    let result = rx
        .await
        .map_err(|_| "Reader task dropped before prompt response".to_string())?;

    // Emit done chunk (tagged with session_key) so frontend listeners know this session finished.
    let _ = app.emit(
        "acp:message-chunk",
        ChatChunkEvent {
            session_key: session_key.to_string(),
            text: String::new(),
            done: true,
        },
    );

    result.map(|_| ()).map_err(|e| e)
}

/// Shut down and remove a session from the map.
async fn do_shutdown(session_key: &str, state: &AcpState) -> Result<(), String> {
    let mut guard = state.sessions.write().await;
    if let Some(mut inner) = guard.remove(session_key) {
        inner.reader_handle.abort();
        drop(inner.stdin);
        let _ = inner.child.kill().await;
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
    app: AppHandle,
) -> Result<(), String> {
    do_send_prompt(SINGLE_SESSION_KEY, message, &state, &app).await
}

#[tauri::command]
pub async fn acp_is_active(state: State<'_, AcpState>) -> Result<bool, String> {
    let guard = state.sessions.read().await;
    Ok(guard
        .get(SINGLE_SESSION_KEY)
        .map_or(false, |inner| !inner.reader_handle.is_finished()))
}

#[tauri::command]
pub async fn acp_cancel(state: State<'_, AcpState>) -> Result<(), String> {
    let guard = state.sessions.read().await;
    let inner = guard
        .get(SINGLE_SESSION_KEY)
        .ok_or("ACP not initialized")?;

    send_notification(
        &inner.stdin,
        "session/cancel",
        Some(serde_json::json!({ "sessionId": inner.session_id })),
    )
    .await?;

    Ok(())
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
    app: AppHandle,
) -> Result<(), String> {
    do_send_prompt(&session_key, message, &state, &app).await
}

#[tauri::command]
pub async fn acp_is_active_session(
    session_key: String,
    state: State<'_, AcpState>,
) -> Result<bool, String> {
    let guard = state.sessions.read().await;
    Ok(guard
        .get(&session_key)
        .map_or(false, |inner| !inner.reader_handle.is_finished()))
}

#[tauri::command]
pub async fn acp_shutdown_session(
    session_key: String,
    state: State<'_, AcpState>,
) -> Result<(), String> {
    do_shutdown(&session_key, &state).await
}
