export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  tools: string[];
  model: string;
  mcpServers: McpServerConfig[];
  color: string;
  systemPrompt: string;
  createdAt: string;
}
