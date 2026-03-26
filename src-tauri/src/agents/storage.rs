use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::types::{AgentConfig, AgentScope};

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

/// List agents visible for a given project path: global agents + agents for that project.
pub fn list_agents_for_project(app: &AppHandle, project_path: &str) -> Result<Vec<AgentConfig>, String> {
    let all = list_agents(app)?;
    Ok(all
        .into_iter()
        .filter(|a| {
            a.scope == AgentScope::Global
                || a.project_path.as_deref() == Some(project_path)
        })
        .collect())
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

/// Load a single agent config by ID.
pub fn load_agent(app: &AppHandle, id: &str) -> Result<AgentConfig, String> {
    let dir = agents_dir(app)?;
    let path = dir.join(format!("{}.json", id));
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read agent file: {}", e))?;
    serde_json::from_str::<AgentConfig>(&data)
        .map_err(|e| format!("Failed to parse agent file: {}", e))
}

/// Convert an agent name to a filename-safe slug.
/// e.g. "My Weather Agent" → "my-weather-agent"
fn name_to_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in name.chars() {
        if ch.is_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }
    // Trim trailing dash
    slug.trim_end_matches('-').to_string()
}

/// Returns the path to the agent's .md file in the appropriate .claude/agents/ directory.
fn agent_md_path(config: &AgentConfig) -> Option<PathBuf> {
    let base = match config.scope {
        AgentScope::Global => {
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()?;
            PathBuf::from(home)
        }
        AgentScope::Project => {
            PathBuf::from(config.project_path.as_deref()?)
        }
    };
    let slug = name_to_slug(&config.name);
    if slug.is_empty() {
        return None;
    }
    Some(base.join(".claude").join("agents").join(format!("{}.md", slug)))
}

/// Build the markdown content for a Claude Code agent definition file.
fn build_agent_md(config: &AgentConfig) -> String {
    let mut lines: Vec<String> = Vec::new();

    lines.push("---".to_string());
    lines.push(format!("name: {}", config.name));
    if !config.description.is_empty() {
        lines.push(format!("description: {}", config.description));
    }
    if !config.tools.is_empty() {
        lines.push(format!("tools: {}", config.tools.join(", ")));
    }
    if !config.model.is_empty() {
        lines.push(format!("model: {}", config.model));
    }
    if !config.mcp_servers.is_empty() {
        lines.push("mcpServers:".to_string());
        for server in &config.mcp_servers {
            // YAML object key (not list item) — Claude Code format
            lines.push(format!("  {}:", server.name));
            lines.push("    type: stdio".to_string());
            lines.push(format!("    command: {}", server.command));
            // args as inline JSON array with spaces: ["arg1", "arg2"]
            let args_items: Vec<String> = server.args.iter()
                .map(|a| format!("\"{}\"", a))
                .collect();
            lines.push(format!("    args: [{}]", args_items.join(", ")));
            if !server.env.is_empty() {
                lines.push("    env:".to_string());
                for (k, v) in &server.env {
                    lines.push(format!("      {}: {}", k, v));
                }
            }
        }
    }
    lines.push("---".to_string());

    if !config.system_prompt.is_empty() {
        lines.push(String::new());
        lines.push(config.system_prompt.trim().to_string());
    }

    lines.join("\n")
}

/// Write the agent's .md file to the appropriate .claude/agents/ directory.
pub fn write_agent_md(config: &AgentConfig) -> Result<(), String> {
    let path = match agent_md_path(config) {
        Some(p) => p,
        None => return Ok(()), // No path resolvable (e.g. empty name), skip silently
    };

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create .claude/agents dir: {}", e))?;
    }

    let content = build_agent_md(config);
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write agent .md file: {}", e))?;

    Ok(())
}

/// Delete the agent's .md file from the appropriate .claude/agents/ directory.
pub fn delete_agent_md(config: &AgentConfig) -> Result<(), String> {
    if let Some(path) = agent_md_path(config) {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete agent .md file: {}", e))?;
        }
    }
    Ok(())
}
