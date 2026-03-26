use std::path::PathBuf;

use super::types::TaskRecord;

/// Returns the tasks directory for a project, creating it if it doesn't exist.
pub fn tasks_dir(project_path: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(project_path).join(".claude").join("tasks");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create tasks dir: {}", e))?;
    }
    Ok(dir)
}

/// Save a task record to disk as {id}.json.
pub fn save_task(project_path: &str, record: &TaskRecord) -> Result<(), String> {
    let dir = tasks_dir(project_path)?;
    let path = dir.join(format!("{}.json", record.id));
    let data = serde_json::to_string_pretty(record)
        .map_err(|e| format!("Failed to serialize task: {}", e))?;
    std::fs::write(&path, data)
        .map_err(|e| format!("Failed to write task file: {}", e))?;
    Ok(())
}

/// List all task records for a project, sorted by timestamp ascending (oldest first).
pub fn list_tasks(project_path: &str) -> Result<Vec<TaskRecord>, String> {
    let dir = tasks_dir(project_path)?;

    let mut records: Vec<TaskRecord> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read tasks dir: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let data = std::fs::read_to_string(&path).ok()?;
            serde_json::from_str::<TaskRecord>(&data).ok()
        })
        .collect();

    records.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(records)
}

/// Delete all task records for a project.
pub fn clear_tasks(project_path: &str) -> Result<(), String> {
    let dir = tasks_dir(project_path)?;

    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read tasks dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete task file: {}", e))?;
        }
    }

    Ok(())
}
