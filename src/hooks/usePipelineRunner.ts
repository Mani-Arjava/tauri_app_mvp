import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentConfig } from "../types/agent";
import type { Pipeline, PipelineNode, PipelineEdge, PipelineNodeState } from "../types/pipeline";
import { detectCycle, getExecutionLayers } from "../utils/graph";
import { generateId } from "../utils/id";

interface ChatChunkPayload {
  session_key: string;
  text: string;
  done: boolean;
}

interface UsePipelineRunnerReturn {
  nodeStates: Record<string, PipelineNodeState>;
  isRunning: boolean;
  error: string | null;
  runPipeline: (
    pipeline: Pipeline,
    agents: AgentConfig[],
    initialInput: string,
    projectPath: string | null
  ) => Promise<void>;
  cancelRun: () => void;
  resetRun: () => void;
}

/** Build the context prompt for a pipeline node. */
function buildNodePrompt(
  _node: PipelineNode,
  agent: AgentConfig,
  upstreamEdges: PipelineEdge[],
  nodeOutputs: Record<string, string>,
  allNodes: PipelineNode[],
  allAgents: AgentConfig[],
  initialInput: string
): string {
  const agentMap = new Map(allAgents.map((a) => [a.id, a]));
  const parts: string[] = [];

  if (agent.systemPrompt?.trim()) {
    parts.push(agent.systemPrompt.trim());
  }

  if (upstreamEdges.length > 0) {
    for (const edge of upstreamEdges) {
      const upstreamNode = allNodes.find((n) => n.id === edge.from);
      const upstreamAgent = upstreamNode ? agentMap.get(upstreamNode.agentId) : null;
      const upstreamName = upstreamNode?.label ?? upstreamAgent?.name ?? edge.from;
      const upstreamOutput = nodeOutputs[edge.from] ?? "";
      parts.push(`=== Output from [${upstreamName}] ===\n${upstreamOutput}`);
    }
  }

  parts.push(`=== Your Task ===\n${initialInput}`);
  return parts.join("\n\n");
}

export function usePipelineRunner(): UsePipelineRunnerReturn {
  const [nodeStates, setNodeStates] = useState<Record<string, PipelineNodeState>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPipeline = useCallback(async (
    pipeline: Pipeline,
    agents: AgentConfig[],
    initialInput: string,
    projectPath: string | null
  ): Promise<void> => {
    if (!initialInput.trim()) return;
    if (pipeline.nodes.length === 0) {
      setError("Pipeline has no agents.");
      return;
    }
    if (detectCycle(pipeline.nodes, pipeline.edges)) {
      setError("Pipeline has a cycle and cannot be executed.");
      return;
    }

    const layers = getExecutionLayers(pipeline.nodes, pipeline.edges);
    if (layers.length === 0) return;

    const runId = generateId();
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    // Initialize all nodes as pending
    const initialStates: Record<string, PipelineNodeState> = {};
    pipeline.nodes.forEach((n) => {
      initialStates[n.id] = { status: "pending", output: "", error: null };
    });
    setNodeStates(initialStates);
    setIsRunning(true);
    setError(null);

    // nodeOutputs accumulates completed outputs for context passing
    const nodeOutputs: Record<string, string> = {};

    try {
      for (const layer of layers) {
        const layerResults = await Promise.all(
          layer.map(async (nodeId) => {
            const node = pipeline.nodes.find((n) => n.id === nodeId)!;
            const agent = agentMap.get(node.agentId);

            if (!agent) {
              setNodeStates((prev) => ({
                ...prev,
                [nodeId]: { status: "error", output: "", error: "Agent not found. It may have been deleted." },
              }));
              return { nodeId, success: false };
            }

            const sessionKey = `${nodeId}|${runId}`;
            const upstreamEdges = pipeline.edges.filter((e) => e.to === nodeId);
            const prompt = buildNodePrompt(
              node as PipelineNode, agent, upstreamEdges, nodeOutputs,
              pipeline.nodes, agents, initialInput
            );

            setNodeStates((prev) => ({
              ...prev,
              [nodeId]: { status: "running", output: "", error: null },
            }));

            // Listen for streaming chunks from this specific session
            const unlisten = await listen<ChatChunkPayload>("acp:message-chunk", (event) => {
              if (event.payload.session_key !== sessionKey) return;
              if (!event.payload.done) {
                nodeOutputs[nodeId] = (nodeOutputs[nodeId] ?? "") + event.payload.text;
                setNodeStates((prev) => ({
                  ...prev,
                  [nodeId]: { ...prev[nodeId], output: nodeOutputs[nodeId] },
                }));
              }
            });

            try {
              await invoke("acp_initialize_session", {
                sessionKey,
                mcpServers: agent.mcpServers.map((s) => ({
                  name: s.name,
                  command: s.command,
                  args: s.args,
                  env: s.env,
                })),
                model: agent.model || null,
                cwd: projectPath || null,
              });

              await invoke("acp_send_prompt_session", { sessionKey, message: prompt });

              setNodeStates((prev) => ({
                ...prev,
                [nodeId]: { ...prev[nodeId], status: "done" },
              }));

              return { nodeId, success: true };
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              setNodeStates((prev) => ({
                ...prev,
                [nodeId]: { status: "error", output: prev[nodeId]?.output ?? "", error: msg },
              }));
              return { nodeId, success: false };
            } finally {
              unlisten();
              await invoke("acp_shutdown_session", { sessionKey }).catch(() => {});
            }
          })
        );

        // Stop pipeline if any node in this layer failed
        const failed = layerResults.filter((r) => !r.success);
        if (failed.length > 0) {
          const names = failed
            .map((r) => {
              const node = pipeline.nodes.find((n) => n.id === r.nodeId);
              const agent = node ? agentMap.get(node.agentId) : null;
              return agent?.name ?? r.nodeId;
            })
            .join(", ");
          setError(`Pipeline stopped — failed node(s): ${names}`);
          break;
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, []);

  const cancelRun = useCallback((): void => {
    // Mark all running nodes as cancelled
    setNodeStates((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((nodeId) => {
        if (updated[nodeId].status === "running") {
          updated[nodeId] = { ...updated[nodeId], status: "error", error: "Cancelled" };
        }
      });
      return updated;
    });
    setIsRunning(false);
  }, []);

  const resetRun = useCallback((): void => {
    setNodeStates({});
    setIsRunning(false);
    setError(null);
  }, []);

  return { nodeStates, isRunning, error, runPipeline, cancelRun, resetRun };
}
