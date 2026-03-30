use serde::Serialize;

/// Event payload emitted to the frontend for streaming text chunks.
/// `session_key` identifies which ACP session emitted the chunk.
/// Single-agent commands use `"__single__"` as the key.
#[derive(Clone, Serialize)]
pub struct ChatChunkEvent {
    pub session_key: String,
    pub text: String,
    pub done: bool,
}

/// Event payload emitted when an ACP process exits.
#[derive(Clone, Serialize)]
pub struct AcpDisconnectedEvent {
    pub session_key: String,
}
