import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AgentConfig } from "../types/agent";

type CreateAgentInput = Omit<AgentConfig, "id" | "createdAt">;

interface UseAgentsReturn {
  agents: AgentConfig[];
  isLoading: boolean;
  error: string | null;
  createAgent: (config: CreateAgentInput) => Promise<AgentConfig>;
  updateAgent: (config: AgentConfig) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  refreshAgents: () => Promise<void>;
}

export function useAgents(): UseAgentsReturn {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshAgents = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await invoke<AgentConfig[]>("agent_list");
      setAgents(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const createAgent = async (config: CreateAgentInput): Promise<AgentConfig> => {
    try {
      setError(null);
      const created = await invoke<AgentConfig>("agent_create", { config });
      await refreshAgents();
      return created;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  };

  const updateAgent = async (config: AgentConfig): Promise<void> => {
    try {
      setError(null);
      await invoke<AgentConfig>("agent_update", { config });
      await refreshAgents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  };

  const deleteAgent = async (id: string): Promise<void> => {
    try {
      setError(null);
      await invoke<void>("agent_delete", { id });
      await refreshAgents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  };

  useEffect(() => {
    refreshAgents();
  }, []);

  return { agents, isLoading, error, createAgent, updateAgent, deleteAgent, refreshAgents };
}
