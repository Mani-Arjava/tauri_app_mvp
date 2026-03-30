import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentConfig } from "../types/agent";
import type { TaskResult } from "../types/task";
import { generateId } from "../utils/id";

interface ChatChunkPayload {
  session_key: string;
  text: string;
  done: boolean;
}

interface UseTaskRunnerReturn {
  results: TaskResult[];
  isRunning: boolean;
  error: string | null;
  runTask: (agent: AgentConfig, taskDescription: string, projectPath: string | null) => Promise<void>;
  cancelTask: () => Promise<void>;
  clearResults: () => void;
  resetSession: () => Promise<void>;
}

// Module-level session state — survives component unmount/remount.
let _activeSessionKey: string | null = null;

// Conversation history injected into every prompt.
// claude-code-acp does NOT maintain conversation history within a session;
// each session/prompt call starts a fresh Claude conversation. We re-send
// the full history on every task so Claude always has context.
interface Turn { user: string; assistant: string }
let _turns: Turn[] = [];
let _pendingTurnUser: string | null = null;
let _pendingTurnResponse = "";

function buildContextPrompt(systemPrompt: string, turns: Turn[], task: string): string {
  const parts: string[] = [];
  if (systemPrompt) parts.push(systemPrompt);
  if (turns.length > 0) {
    const history = turns
      .map((t) => `Human: ${t.user}\n\nAssistant: ${t.assistant}`)
      .join("\n\n---\n\n");
    parts.push(`[Previous conversation context]\n${history}`);
  }
  parts.push(task);
  return parts.join("\n\n");
}

export function useTaskRunner(projectPath: string | null): UseTaskRunnerReturn {
  const [results, setResults] = useState<TaskResult[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const prevResultsRef = useRef<TaskResult[]>([]);
  // Per-instance flag: true only on the very first render of this component instance.
  // Distinguishes "initial/same-path remount" (keep history) from "project switch" (clear history).
  const isFirstRender = useRef(true);

  // Reset session state and load task history when projectPath changes.
  useEffect(() => {
    _activeSessionKey = null;

    // Only clear conversation history on an actual project switch (not on initial
    // mount or remount with the same path after navigation).
    if (!isFirstRender.current) {
      _turns = [];
      _pendingTurnUser = null;
      _pendingTurnResponse = "";
    }
    isFirstRender.current = false;

    if (projectPath) {
      invoke<TaskResult[]>("task_list", { projectPath })
        .then((records) => {
          setResults(records.map((r) => ({ ...r, isStreaming: false })));
        })
        .catch(() => setResults([]));
    } else {
      setResults([]);
    }
  }, [projectPath]);

  // Save completed task to disk when a result transitions from streaming to done.
  useEffect(() => {
    if (!projectPath) {
      prevResultsRef.current = results;
      return;
    }
    const prev = prevResultsRef.current;
    if (results.length > 0 && prev.length > 0) {
      const last = results[results.length - 1];
      const prevLast = prev[prev.length - 1];
      if (prevLast?.isStreaming && !last.isStreaming) {
        const { isStreaming: _omit, ...record } = last;
        invoke("task_save", { projectPath, record }).catch(() => {});
      }
    }
    prevResultsRef.current = results;
  }, [results, projectPath]);

  useEffect(() => {
    const unlistenChunk = listen<ChatChunkPayload>("acp:message-chunk", (event) => {
      // Only process events from the single-agent session; pipeline sessions use their own keys.
      if (event.payload.session_key !== "__single__") return;
      if (event.payload.done) {
        // Save the completed turn to history so future tasks include it.
        if (_pendingTurnUser !== null) {
          _turns.push({ user: _pendingTurnUser, assistant: _pendingTurnResponse });
          _pendingTurnUser = null;
          _pendingTurnResponse = "";
        }
        setResults((prev) =>
          prev.map((r, i) =>
            i === prev.length - 1 && r.isStreaming ? { ...r, isStreaming: false } : r
          )
        );
        setIsRunning(false);
      } else {
        // Accumulate response text for history tracking.
        _pendingTurnResponse += event.payload.text;
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

    const unlistenDisconnected = listen<{ session_key: string }>("acp:disconnected", (event) => {
      if (event.payload.session_key !== "__single__") return;
      // ACP process exited. Reset session key so the next task restarts the process.
      // Keep _turns — history is re-injected into every new prompt anyway.
      // DO NOT clear _pendingTurnUser: race condition with the done event.
      // Both emit from different Rust tasks; disconnect may arrive first.
      // The done handler fires shortly after and correctly saves the turn.
      _activeSessionKey = null;
      setIsRunning(false);
    });

    return () => {
      unlistenChunk.then((fn) => fn());
      unlistenDisconnected.then((fn) => fn());
    };
  }, []);

  const runTask = useCallback(async (
    agent: AgentConfig,
    taskDescription: string,
    taskProjectPath: string | null
  ): Promise<void> => {
    setIsRunning(true);
    setError(null);

    try {
      // Discard any pending turn left over from a crashed previous session.
      if (_pendingTurnUser !== null) {
        _pendingTurnUser = null;
        _pendingTurnResponse = "";
      }

      const newSessionKey = `${agent.id}|${taskProjectPath ?? "global"}`;
      const sessionAlive = await invoke<boolean>("acp_is_active");
      const needsNewSession = !sessionAlive || _activeSessionKey !== newSessionKey;

      if (needsNewSession) {
        try {
          await invoke("acp_shutdown");
        } catch {
          // Ignore errors from shutting down a non-existent session
        }

        await invoke("acp_initialize", {
          mcpServers: agent.mcpServers.map((s) => ({
            name: s.name,
            command: s.command,
            args: s.args,
            env: s.env,
          })),
          model: agent.model || null,
          cwd: taskProjectPath || null,
        });

        _activeSessionKey = newSessionKey;
      }

      // Always build the full context prompt: system prompt + all prior turns + current task.
      // This ensures Claude has conversation history on every call, since claude-code-acp
      // does not persist history between session/prompt calls.
      const promptToSend = buildContextPrompt(
        agent.systemPrompt?.trim() ?? "",
        _turns,
        taskDescription
      );

      _pendingTurnUser = taskDescription;
      _pendingTurnResponse = "";

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
      await invoke("acp_send_prompt", { message: promptToSend });
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
    _pendingTurnUser = null;
    _pendingTurnResponse = "";
    setResults((prev) =>
      prev.map((r) => (r.isStreaming ? { ...r, isStreaming: false } : r))
    );
    setIsRunning(false);
  }, []);

  const clearResults = useCallback((): void => {
    if (projectPath) {
      invoke("task_clear", { projectPath }).catch(() => {});
    }
    setResults([]);
  }, [projectPath]);

  const resetSession = useCallback(async (): Promise<void> => {
    try {
      await invoke("acp_shutdown");
    } catch {
      // Ignore errors
    }
    _activeSessionKey = null;
    _turns = [];
    _pendingTurnUser = null;
    _pendingTurnResponse = "";
  }, []);

  return { results, isRunning, error, runTask, cancelTask, clearResults, resetSession };
}
