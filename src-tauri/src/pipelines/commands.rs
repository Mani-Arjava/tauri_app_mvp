use tauri::AppHandle;

use super::storage;
use super::types::Pipeline;

#[tauri::command]
pub fn pipeline_list(app: AppHandle) -> Result<Vec<Pipeline>, String> {
    storage::list_pipelines(&app)
}

#[tauri::command]
pub fn pipeline_create(mut pipeline: Pipeline, app: AppHandle) -> Result<Pipeline, String> {
    pipeline.id = uuid::Uuid::new_v4().to_string();
    pipeline.created_at = timestamp_now();
    storage::save_pipeline(&app, &pipeline)?;
    Ok(pipeline)
}

#[tauri::command]
pub fn pipeline_update(pipeline: Pipeline, app: AppHandle) -> Result<Pipeline, String> {
    storage::save_pipeline(&app, &pipeline)?;
    Ok(pipeline)
}

#[tauri::command]
pub fn pipeline_delete(id: String, app: AppHandle) -> Result<(), String> {
    storage::delete_pipeline(&app, &id)
}

/// Returns the current time as a Unix timestamp string (seconds since epoch).
fn timestamp_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", now.as_secs())
}
