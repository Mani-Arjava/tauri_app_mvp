use serde::{Deserialize, Serialize};
use serde_json::Value;

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

/// Raw JSON-RPC message read from the agent's stdout.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct JsonRpcIncoming {
    pub jsonrpc: String,
    /// Present on responses and error responses; absent on notifications and agent requests.
    pub id: Option<Value>,
    /// Present on notifications and agent requests.
    pub method: Option<String>,
    /// Present on successful responses.
    pub result: Option<Value>,
    /// Present on error responses.
    pub error: Option<JsonRpcError>,
    /// Present on notifications and agent requests.
    pub params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

/// Classified form of an incoming JSON-RPC message.
#[allow(dead_code)]
pub enum AcpMessage {
    /// A successful response to a request we sent (has `id` + `result`).
    Response { id: u64, result: Value },
    /// An error response to a request we sent (has `id` + `error`).
    ErrorResponse { id: u64, error: JsonRpcError },
    /// A notification from the agent (has `method` + optional `params`, no `id`).
    Notification { method: String, params: Option<Value> },
    /// A request from the agent expecting a response (has `id` + `method` + optional `params`).
    AgentRequest { id: Value, method: String, params: Option<Value> },
}

impl JsonRpcIncoming {
    /// Classify a raw JSON-RPC message into a typed variant.
    pub fn classify(self) -> Option<AcpMessage> {
        // Has an id — it's a response or an agent request
        if let Some(id_val) = self.id {
            // If it has a method, it's a request from the agent
            if let Some(method) = self.method {
                return Some(AcpMessage::AgentRequest {
                    id: id_val,
                    method,
                    params: self.params,
                });
            }
            // Extract numeric id for our responses
            let id = id_val.as_u64()?;
            if let Some(error) = self.error {
                return Some(AcpMessage::ErrorResponse { id, error });
            }
            return Some(AcpMessage::Response {
                id,
                result: self.result.unwrap_or(Value::Null),
            });
        }
        // No id — it's a notification
        if let Some(method) = self.method {
            return Some(AcpMessage::Notification {
                method,
                params: self.params,
            });
        }
        None
    }
}
