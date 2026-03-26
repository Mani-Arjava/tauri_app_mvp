import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentConfig } from "../types/agent";
import type { TaskResult } from "../types/task";
import { generateId } from "../utils/id";

interface ChatChunkPayload {
  text: string;
  done: boolean;
}

interface UseTaskRunnerReturn {
  results: TaskResult[];
  isRunning: boolean;
  error: string | null;
  runTask: (agent: AgentConfig, taskDescription: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  clearResults: () => void;
}

export function useTaskRunner(): UseTaskRunnerReturn {
  const [results, setResults] = useState<TaskResult[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlistenChunk = listen<ChatChunkPayload>("acp:message-chunk", (event) => {
      if (event.payload.done) {
        setResults((prev) =>
          prev.map((r, i) =>
            i === prev.length - 1 && r.isStreaming ? { ...r, isStreaming: false } : r
          )
        );
        setIsRunning(false);
      } else {
        setResults((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming) {
            return prev.map((r, i) =>
              i === prev.length - 1
                ? { ...r, response: r.response + event.payload.text }
                : r
            );
          }
          return prev;
        });
      }
    });

    const unlistenDisconnected = listen("acp:disconnected", () => {
      setIsRunning(false);
    });

    return () => {
      unlistenChunk.then((fn) => fn());
      unlistenDisconnected.then((fn) => fn());
    };
  }, []);

  const runTask = useCallback(async (agent: AgentConfig, taskDescription: string): Promise<void> => {
    setIsRunning(true);
    setError(null);

    try {
      try {
        await invoke("acp_shutdown");
      } catch {
        // Ignore errors from shutting down a non-existent session
      }

      // Initialize ACP with this agent's MCP servers and system prompt.
      // The Rust side sends the system prompt silently (suppressing events)
      // and only returns once the session is fully ready.
      await invoke("acp_initialize", {
        mcpServers: agent.mcpServers.map((s) => ({
          name: s.name,
          command: s.command,
          args: s.args,
          env: s.env,
        })),
        model: agent.model || null,
      });

      const taskPrompt = agent.systemPrompt?.trim()
        ? `${agent.systemPrompt}\n\n${taskDescription}`
        : taskDescription;

      const newResult: TaskResult = {
        id: generateId(),
        agentId: agent.id,
        agentName: agent.name,
        agentColor: agent.color,
        agentModel: agent.model,
        agentMcpServers: agent.mcpServers.map((s) => s.name),
        taskDescription,
        response: "",
        isStreaming: true,
        timestamp: new Date().toISOString(),
        error: null,
      };

      setResults((prev) => [...prev, newResult]);
      await invoke("acp_send_prompt", { message: taskPrompt });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsRunning(false);
    }
  }, []);

  const cancelTask = useCallback(async (): Promise<void> => {
    try {
      await invoke("acp_cancel");
    } catch {
      // Ignore cancel errors
    }
    setResults((prev) =>
      prev.map((r) => (r.isStreaming ? { ...r, isStreaming: false } : r))
    );
    setIsRunning(false);
  }, []);

  const clearResults = useCallback((): void => {
    setResults([]);
  }, []);

  return { results, isRunning, error, runTask, cancelTask, clearResults };
}
