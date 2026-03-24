use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use serde_json::Value;
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::task::JoinHandle;

/// Tauri managed state — wraps an optional active ACP session.
pub struct AcpState {
    pub inner: Arc<RwLock<Option<AcpInner>>>,
}

impl AcpState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(None)),
        }
    }
}

/// Holds state for the persistent ACP subprocess.
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
