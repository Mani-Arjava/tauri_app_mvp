use tauri::AppHandle;

use super::storage;
use super::types::AgentConfig;

#[tauri::command]
pub fn agent_list(app: AppHandle) -> Result<Vec<AgentConfig>, String> {
    storage::list_agents(&app)
}

#[tauri::command]
pub fn agent_create(
    mut config: AgentConfig,
    app: AppHandle,
) -> Result<AgentConfig, String> {
    config.id = uuid::Uuid::new_v4().to_string();
    config.created_at = chrono_now();
    storage::save_agent(&app, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn agent_update(
    config: AgentConfig,
    app: AppHandle,
) -> Result<AgentConfig, String> {
    storage::save_agent(&app, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn agent_delete(id: String, app: AppHandle) -> Result<(), String> {
    storage::delete_agent(&app, &id)
}

/// Returns the current UTC time as an ISO 8601 string.
fn chrono_now() -> String {
    // Use std::time to avoid adding chrono dependency
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // Format as simple timestamp — frontend can format for display
    format!("{}Z", now.as_secs())
}
