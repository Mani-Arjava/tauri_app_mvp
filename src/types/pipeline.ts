export interface PipelineNode {
  id: string;
  agentId: string;
  label: string | null;
}

export interface PipelineEdge {
  from: string;
  to: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  createdAt: string;
}

export interface PipelineNodeState {
  status: "pending" | "running" | "done" | "error";
  output: string;
  error: string | null;
}
