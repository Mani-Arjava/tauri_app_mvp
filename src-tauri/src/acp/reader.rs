use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{oneshot, Mutex};

use super::types::{AcpMessage, ChatChunkEvent, JsonRpcIncoming};

/// Background task: reads JSON-RPC lines from the agent's stdout and dispatches them.
///
/// - **Response / ErrorResponse** → completes the matching oneshot in `pending`
/// - **Notification `session/update`** → extracts text chunks → emits `acp:message-chunk`
/// - **AgentRequest `session/request_permission`** → auto-rejects by writing response to stdin
/// - On stdout close → emits `acp:disconnected`
pub async fn run_reader(
    stdout: ChildStdout,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    app_handle: AppHandle,
) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let incoming: JsonRpcIncoming = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let msg = match incoming.classify() {
            Some(m) => m,
            None => continue,
        };

        match msg {
            AcpMessage::Response { id, result } => {
                let mut map = pending.lock().await;
                if let Some(tx) = map.remove(&id) {
                    let _ = tx.send(Ok(result));
                }
            }
            AcpMessage::ErrorResponse { id, error } => {
                let mut map = pending.lock().await;
                if let Some(tx) = map.remove(&id) {
                    let _ = tx.send(Err(format!(
                        "ACP error {}: {}",
                        error.code, error.message
                    )));
                }
            }
            AcpMessage::Notification { method, params } => {
                if method == "session/update" {
                    if let Some(text) = extract_chunk_text(&params) {
                        if !text.is_empty() {
                            let _ = app_handle.emit(
                                "acp:message-chunk",
                                ChatChunkEvent {
                                    text,
                                    done: false,
                                },
                            );
                        }
                    }
                }
            }
            AcpMessage::AgentRequest { id, method, .. } => {
                if method == "session/request_permission" {
                    // Auto-reject permission requests
                    let response = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "outcome": "reject_once" }
                    });
                    let mut line_out = serde_json::to_string(&response).unwrap();
                    line_out.push('\n');
                    let mut stdin_guard = stdin.lock().await;
                    let _ = stdin_guard.write_all(line_out.as_bytes()).await;
                    let _ = stdin_guard.flush().await;
                }
            }
        }
    }

    // stdout closed — agent exited
    let _ = app_handle.emit("acp:disconnected", ());
}

/// Extract text from a `session/update` notification's params.
///
/// Expected shape (from claude-code-acp bridge):
/// ```json
/// {
///   "sessionId": "...",
///   "update": {
///     "sessionUpdate": "agent_message_chunk",
///     "content": { "text": "Hello" }
///   }
/// }
/// ```
fn extract_chunk_text(params: &Option<Value>) -> Option<String> {
    let params = params.as_ref()?;
    let update = params.get("update")?;
    let update_type = update.get("sessionUpdate").and_then(|t| t.as_str())?;
    if update_type != "agent_message_chunk" {
        return None;
    }
    let text = update.get("content")?.get("text")?.as_str()?;
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}
