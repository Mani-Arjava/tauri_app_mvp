use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use serde_json::Value;
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::task::JoinHandle;

/// Session key used by the single-agent commands (acp_initialize, acp_send_prompt, etc.)
pub const SINGLE_SESSION_KEY: &str = "__single__";

/// Tauri managed state — holds a map of active ACP sessions keyed by session_key.
pub struct AcpState {
    pub sessions: Arc<RwLock<HashMap<String, AcpInner>>>,
}

impl AcpState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

/// Holds state for a single ACP subprocess.
pub struct AcpInner {
    /// The long-running `claude-code-acp` child process.
    pub child: Child,
    /// Shared stdin — used by commands to send requests and by reader to respond to agent requests.
    pub stdin: Arc<Mutex<ChildStdin>>,
    /// Monotonically increasing JSON-RPC request ID counter.
    pub next_id: AtomicU64,
    /// Session ID returned by `session/new`.
    pub session_id: String,
    /// Pending request ID → oneshot sender. Reader completes these when responses arrive.
    pub pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    /// Handle to the background reader task (for cleanup).
    pub reader_handle: JoinHandle<()>,
}
