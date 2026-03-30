import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Pipeline } from "../types/pipeline";

type CreatePipelineInput = Omit<Pipeline, "id" | "createdAt">;

interface UsePipelinesReturn {
  pipelines: Pipeline[];
  isLoading: boolean;
  error: string | null;
  createPipeline: (input: CreatePipelineInput) => Promise<Pipeline>;
  updatePipeline: (pipeline: Pipeline) => Promise<void>;
  deletePipeline: (id: string) => Promise<void>;
  refreshPipelines: () => Promise<void>;
}

export function usePipelines(): UsePipelinesReturn {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshPipelines = useCallback(async () => {
    try {
      const list = await invoke<Pipeline[]>("pipeline_list");
      setPipelines(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    invoke<Pipeline[]>("pipeline_list")
      .then((list) => {
        setPipelines(list);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });
  }, []);

  const createPipeline = useCallback(async (input: CreatePipelineInput): Promise<Pipeline> => {
    const created = await invoke<Pipeline>("pipeline_create", { pipeline: input });
    await refreshPipelines();
    return created;
  }, [refreshPipelines]);

  const updatePipeline = useCallback(async (pipeline: Pipeline): Promise<void> => {
    await invoke("pipeline_update", { pipeline });
    await refreshPipelines();
  }, [refreshPipelines]);

  const deletePipeline = useCallback(async (id: string): Promise<void> => {
    await invoke("pipeline_delete", { id });
    await refreshPipelines();
  }, [refreshPipelines]);

  return { pipelines, isLoading, error, createPipeline, updatePipeline, deletePipeline, refreshPipelines };
}
