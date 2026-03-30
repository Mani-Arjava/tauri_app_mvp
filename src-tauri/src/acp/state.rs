use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::{mpsc, oneshot, RwLock};

/// Session key used by the single-agent commands (acp_initialize, acp_send_prompt, etc.)
pub const SINGLE_SESSION_KEY: &str = "__single__";

/// Command sent from the main Tauri runtime to the background session thread.
pub enum SessionCommand {
    Prompt {
        message: String,
        resp: oneshot::Sender<Result<(), String>>,
    },
    Cancel,
    Shutdown,
}

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

/// Holds state for a single ACP session.
///
/// Each session runs on a dedicated OS thread with its own single-threaded tokio runtime
/// and LocalSet. This sidesteps the !Send constraint on ClientSideConnection's internal
/// background tasks while keeping ClientSideConnection itself in a Send+Sync Arc.
pub struct AcpInner {
    /// Channel to send commands to the background session thread.
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    /// Session ID returned by session/new (stored for potential future use).
    #[allow(dead_code)]
    pub session_id: String,
    /// True while the background session thread is still running.
    pub is_running: Arc<AtomicBool>,
    /// Background OS thread handle (kept to prevent premature drop).
    pub _thread: std::thread::JoinHandle<()>,
}

impl AcpInner {
    pub fn is_alive(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }
}
