use tauri::AppHandle;

use super::storage;

#[tauri::command]
pub fn project_list(app: AppHandle) -> Result<Vec<String>, String> {
    storage::list_projects(&app)
}

#[tauri::command]
pub fn project_add(path: String, app: AppHandle) -> Result<(), String> {
    storage::add_project(&app, &path)
}

#[tauri::command]
pub fn project_remove(path: String, app: AppHandle) -> Result<(), String> {
    storage::remove_project(&app, &path)
}
