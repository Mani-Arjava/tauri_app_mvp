use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub agent_color: String,
    pub agent_model: String,
    pub agent_mcp_servers: Vec<String>,
    pub task_description: String,
    pub response: String,
    pub timestamp: String,
    pub error: Option<String>,
}
