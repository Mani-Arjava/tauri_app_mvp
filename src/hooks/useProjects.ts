import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UseProjectsReturn {
  projects: string[];
  isLoading: boolean;
  addProject: (path: string) => Promise<void>;
  removeProject: (path: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await invoke<string[]>("project_list");
      setProjects(list);
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    refreshProjects().finally(() => setIsLoading(false));
  }, [refreshProjects]);

  const addProject = useCallback(async (path: string): Promise<void> => {
    await invoke("project_add", { path });
    await refreshProjects();
  }, [refreshProjects]);

  const removeProject = useCallback(async (path: string): Promise<void> => {
    await invoke("project_remove", { path });
    await refreshProjects();
  }, [refreshProjects]);

  return { projects, isLoading, addProject, removeProject, refreshProjects };
}
