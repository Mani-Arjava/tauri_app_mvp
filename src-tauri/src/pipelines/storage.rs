use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::types::Pipeline;

/// Returns the pipelines storage directory, creating it if it doesn't exist.
pub fn pipelines_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("pipelines");

    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create pipelines dir: {}", e))?;
    }

    Ok(dir)
}

/// List all saved pipelines, sorted by creation date (newest first).
pub fn list_pipelines(app: &AppHandle) -> Result<Vec<Pipeline>, String> {
    let dir = pipelines_dir(app)?;

    let mut pipelines: Vec<Pipeline> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read pipelines dir: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let data = std::fs::read_to_string(&path).ok()?;
            serde_json::from_str::<Pipeline>(&data).ok()
        })
        .collect();

    pipelines.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(pipelines)
}

/// Save a pipeline to disk.
pub fn save_pipeline(app: &AppHandle, pipeline: &Pipeline) -> Result<(), String> {
    let dir = pipelines_dir(app)?;
    let path = dir.join(format!("{}.json", pipeline.id));
    let data = serde_json::to_string_pretty(pipeline)
        .map_err(|e| format!("Failed to serialize pipeline: {}", e))?;
    std::fs::write(&path, data)
        .map_err(|e| format!("Failed to write pipeline file: {}", e))?;
    Ok(())
}

/// Delete a pipeline from disk.
pub fn delete_pipeline(app: &AppHandle, id: &str) -> Result<(), String> {
    let dir = pipelines_dir(app)?;
    let path = dir.join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete pipeline file: {}", e))?;
    }
    Ok(())
}
