use super::storage;
use super::types::TaskRecord;

#[tauri::command]
pub fn task_save(project_path: String, record: TaskRecord) -> Result<(), String> {
    storage::save_task(&project_path, &record)
}

#[tauri::command]
pub fn task_list(project_path: String) -> Result<Vec<TaskRecord>, String> {
    storage::list_tasks(&project_path)
}

#[tauri::command]
pub fn task_clear(project_path: String) -> Result<(), String> {
    storage::clear_tasks(&project_path)
}
