export interface TaskResult {
  id: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  agentModel: string;
  agentMcpServers: string[];
  taskDescription: string;
  response: string;
  isStreaming: boolean;
  timestamp: string;
  error: string | null;
}
