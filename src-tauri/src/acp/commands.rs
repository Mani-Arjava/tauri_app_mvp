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
use super::state::{AcpInner, AcpState};
use super::types::ChatChunkEvent;

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

#[tauri::command]
pub async fn acp_initialize(
    mcp_servers: Option<Vec<Value>>,
    model: Option<String>,
    state: State<'_, AcpState>,
    app: AppHandle,
) -> Result<(), String> {
    // Prevent double-init
    {
        let guard = state.inner.read().await;
        if guard.is_some() {
            return Ok(());
        }
    }

    // 1. Spawn claude-code-acp via Claude Code subscription auth.
    //
    // NOTE: API key path is commented out — re-enable when claude-code-acp-rs
    // model selection is verified. With subscription auth the `model` field in
    // session/new is ignored; Claude Code uses its own default model.
    //
    // To re-enable API key path:
    //   1. Add ANTHROPIC_API_KEY to src-tauri/.env
    //   2. Install: cargo install claude-code-acp-rs
    //   3. Uncomment the block below and wrap in if/else on ANTHROPIC_API_KEY
    //
    // let env_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".env");
    // let _ = dotenvy::from_path(&env_path);
    // if let Ok(api_key) = std::env::var("ANTHROPIC_API_KEY") {
    //     Command::new("claude-code-acp-rs")
    //         .env("ANTHROPIC_API_KEY", &api_key)
    //         .stdin(Stdio::piped())
    //         .stdout(Stdio::piped())
    //         .stderr(Stdio::inherit())
    //         .spawn()
    //         .map_err(|e| format!("Failed to start claude-code-acp-rs: {}", e))?
    // } else { ... }

    let preload = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("acp-preload.cjs");
    let mut cmd = Command::new("npx");
    cmd.arg("claude-code-acp")
        .env("NODE_OPTIONS", format!("--require {}", preload.display()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    // Pass model via ANTHROPIC_MODEL env var (official: code.claude.com/docs/en/model-config)
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

    // 2. Start the background reader task
    let reader_handle = tokio::spawn(run_reader(
        stdout,
        Arc::clone(&stdin),
        Arc::clone(&pending),
        app.clone(),
    ));

    // 3. Send `initialize` request
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

    // 4. Send `session/new` request
    let rx = send_request(
        &stdin,
        &pending,
        &next_id,
        "session/new",
        Some(serde_json::json!({
            "cwd": std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| "/tmp".to_string()),
            "mcpServers": mcp_servers.clone().unwrap_or_default()
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

    // 5. Store the inner state
    let inner = AcpInner {
        child,
        stdin,
        next_id,
        session_id,
        pending,
        reader_handle,
    };

    *state.inner.write().await = Some(inner);

    Ok(())
}

#[tauri::command]
pub async fn acp_send_prompt(
    message: String,
    state: State<'_, AcpState>,
    app: AppHandle,
) -> Result<(), String> {
    // Grab references while holding read lock briefly
    let (stdin, pending, request_id, session_id) = {
        let guard = state.inner.read().await;
        let inner = guard.as_ref().ok_or("ACP not initialized")?;
        (
            Arc::clone(&inner.stdin),
            Arc::clone(&inner.pending),
            inner.next_id.fetch_add(1, Ordering::Relaxed),
            inner.session_id.clone(),
        )
    };

    // Build and send the session/prompt request
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

    // Await the final response — reader emits streaming chunks as events meanwhile
    let result = rx
        .await
        .map_err(|_| "Reader task dropped before prompt response".to_string())?;

    match result {
        Ok(_) => {
            // Emit done event
            let _ = app.emit(
                "acp:message-chunk",
                ChatChunkEvent {
                    text: String::new(),
                    done: true,
                },
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "acp:message-chunk",
                ChatChunkEvent {
                    text: String::new(),
                    done: true,
                },
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn acp_cancel(state: State<'_, AcpState>) -> Result<(), String> {
    let guard = state.inner.read().await;
    let inner = guard.as_ref().ok_or("ACP not initialized")?;

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
    let mut guard = state.inner.write().await;
    if let Some(mut inner) = guard.take() {
        // Abort the reader task
        inner.reader_handle.abort();
        // Drop stdin to signal the agent to exit
        drop(inner.stdin);
        // Kill the child process
        let _ = inner.child.kill().await;
    }
    Ok(())
}
