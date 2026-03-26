use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn projects_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    }
    Ok(dir.join("projects.json"))
}

fn read_projects(app: &AppHandle) -> Result<Vec<String>, String> {
    let path = projects_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read projects file: {}", e))?;
    serde_json::from_str::<Vec<String>>(&data)
        .map_err(|e| format!("Failed to parse projects file: {}", e))
}

fn write_projects(app: &AppHandle, projects: &[String]) -> Result<(), String> {
    let path = projects_file(app)?;
    let data = serde_json::to_string_pretty(projects)
        .map_err(|e| format!("Failed to serialize projects: {}", e))?;
    std::fs::write(&path, data)
        .map_err(|e| format!("Failed to write projects file: {}", e))
}

pub fn list_projects(app: &AppHandle) -> Result<Vec<String>, String> {
    let mut projects = read_projects(app)?;
    projects.sort();
    projects.dedup();
    Ok(projects)
}

pub fn add_project(app: &AppHandle, path: &str) -> Result<(), String> {
    let mut projects = read_projects(app)?;
    let path = path.to_string();
    if !projects.contains(&path) {
        projects.push(path);
        projects.sort();
        write_projects(app, &projects)?;
    }
    Ok(())
}

pub fn remove_project(app: &AppHandle, path: &str) -> Result<(), String> {
    let mut projects = read_projects(app)?;
    projects.retain(|p| p != path);
    write_projects(app, &projects)
}
