use agent_client_protocol::{
    Client, ContentBlock, PermissionOptionKind, RequestPermissionRequest,
    RequestPermissionOutcome, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionNotification, SessionUpdate,
};
use tauri::{AppHandle, Emitter};

use super::types::ChatChunkEvent;

/// Implements the ACP `Client` trait for Tauri.
///
/// - Auto-approves all tool permission requests (grants AllowAlways when available).
/// - Routes streaming agent message chunk text to Tauri events tagged with the session key.
///
/// Must be `?Send` because the `Client` trait uses `#[async_trait(?Send)]`.
pub struct TauriAcpClient {
    pub session_key: String,
    pub app: AppHandle,
}

// The Client trait is annotated with #[async_trait::async_trait(?Send)].
// We must use the same attribute on the impl to match the expected method signatures.
#[async_trait::async_trait(?Send)]
impl Client for TauriAcpClient {
    async fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        // Pick the AllowAlways option if present, otherwise use the first available option.
        let option_id = args
            .options
            .iter()
            .find(|o| matches!(o.kind, PermissionOptionKind::AllowAlways))
            .or_else(|| args.options.first())
            .map(|o| o.option_id.clone());

        let outcome = match option_id {
            Some(id) => RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(id)),
            None => RequestPermissionOutcome::Cancelled,
        };

        Ok(RequestPermissionResponse::new(outcome))
    }

    async fn session_notification(
        &self,
        notification: SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        // SessionNotification is a struct with an `update: SessionUpdate` field.
        // We emit Tauri events for agent message text chunks.
        if let Some(text) = extract_chunk_text(&notification.update) {
            if !text.is_empty() {
                let _ = self.app.emit(
                    "acp:message-chunk",
                    ChatChunkEvent {
                        session_key: self.session_key.clone(),
                        text,
                        done: false,
                    },
                );
            }
        }
        Ok(())
    }
}

/// Extract the text string from a SessionUpdate if it is an AgentMessageChunk.
/// ContentChunk.content is a ContentBlock; we look for the Text variant.
fn extract_chunk_text(update: &SessionUpdate) -> Option<String> {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => match &chunk.content {
            ContentBlock::Text(tc) => Some(tc.text.clone()),
            _ => None,
        },
        _ => None,
    }
}
