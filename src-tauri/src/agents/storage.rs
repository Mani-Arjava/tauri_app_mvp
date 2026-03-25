use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::types::AgentConfig;

/// Returns the agents storage directory, creating it if it doesn't exist.
pub fn agents_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("agents");

    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create agents dir: {}", e))?;
    }

    Ok(dir)
}

/// List all saved agent configs, sorted by creation date (newest first).
pub fn list_agents(app: &AppHandle) -> Result<Vec<AgentConfig>, String> {
    let dir = agents_dir(app)?;

    let mut agents: Vec<AgentConfig> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read agents dir: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let data = std::fs::read_to_string(&path).ok()?;
            serde_json::from_str::<AgentConfig>(&data).ok()
        })
        .collect();

    agents.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(agents)
}

/// Save an agent config to disk.
pub fn save_agent(app: &AppHandle, config: &AgentConfig) -> Result<(), String> {
    let dir = agents_dir(app)?;
    let path = dir.join(format!("{}.json", config.id));
    let data =
        serde_json::to_string_pretty(config).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write agent file: {}", e))?;
    Ok(())
}

/// Delete an agent config from disk.
pub fn delete_agent(app: &AppHandle, id: &str) -> Result<(), String> {
    let dir = agents_dir(app)?;
    let path = dir.join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete agent file: {}", e))?;
    }
    Ok(())
}
