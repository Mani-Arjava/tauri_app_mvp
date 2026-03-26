import { useState, useEffect } from "react";
import type { AgentConfig } from "@/types/agent";
import { useTaskRunner } from "@/hooks/useTaskRunner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskResultCard } from "./TaskResultCard";
import { ProjectPathSelector } from "./ProjectPathSelector";

interface TaskRunnerProps {
  agents: AgentConfig[];
}

export function TaskRunner({ agents }: TaskRunnerProps): React.JSX.Element {
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [taskInput, setTaskInput] = useState<string>("");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const { results, isRunning, error, runTask, cancelTask, clearResults } = useTaskRunner();

  const visibleAgents = agents.filter(
    (a) =>
      !a.scope || a.scope === "global" ||
      (a.scope === "project" && a.projectPath === projectPath)
  );

  const selectedAgent = visibleAgents.find((a) => a.id === selectedAgentId);

  useEffect(() => {
    if (selectedAgentId && !visibleAgents.find((a) => a.id === selectedAgentId)) {
      setSelectedAgentId("");
    }
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !taskInput.trim() || isRunning) return;
    await runTask(selectedAgent, taskInput.trim(), projectPath);
    setTaskInput("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Run Task</h2>
        {results.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearResults}>
            Clear Results
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="mb-4">
        <ProjectPathSelector value={projectPath} onChange={setProjectPath} />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 mb-6">
        <div>
          <Label>Agent</Label>
          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an agent..." />
            </SelectTrigger>
            <SelectContent>
              {visibleAgents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: agent.color }}
                    />
                    {agent.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {visibleAgents.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {agents.length === 0
                ? "No agents available. Create one in the My Agents tab first."
                : "No agents for this project. Create a project agent or select a different directory."}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="task">Task</Label>
          <Textarea
            id="task"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            placeholder="Describe your task..."
            rows={3}
            disabled={isRunning}
          />
        </div>

        <div className="flex gap-2">
          {isRunning ? (
            <Button type="button" variant="destructive" onClick={cancelTask}>
              Cancel
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!selectedAgent || !taskInput.trim()}
            >
              Run Task
            </Button>
          )}
        </div>
      </form>

      {results.length > 0 && (
        <ScrollArea className="flex-1">
          <div className="space-y-4">
            {[...results].reverse().map((result) => (
              <TaskResultCard key={result.id} result={result} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
