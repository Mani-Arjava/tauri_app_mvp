export interface TaskResult {
  id: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  taskDescription: string;
  response: string;
  isStreaming: boolean;
  timestamp: string;
  error: string | null;
}
