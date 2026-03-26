import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import type { AgentConfig } from "@/types/agent";
import { useTaskRunner } from "@/hooks/useTaskRunner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentCard } from "@/components/agents/AgentCard";
import { AgentFormDialog } from "@/components/agents/AgentFormDialog";
import { TaskResultCard } from "@/components/tasks/TaskResultCard";

interface ProjectDetailProps {
  projectPath: string;
  agents: AgentConfig[];
  createAgent: (config: Omit<AgentConfig, "id" | "createdAt">) => Promise<AgentConfig>;
  updateAgent: (config: AgentConfig) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  onBack: () => void;
}

export function ProjectDetail({
  projectPath,
  agents,
  createAgent,
  updateAgent,
  deleteAgent,
  onBack,
}: ProjectDetailProps): React.JSX.Element {
  const dirName = projectPath.split("/").filter(Boolean).pop() ?? projectPath;

  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [taskInput, setTaskInput] = useState("");

  const { results, isRunning, error, runTask, cancelTask, clearResults } = useTaskRunner(projectPath);

  const projectAgents = agents.filter(
    (a) => a.scope === "project" && a.projectPath === projectPath
  );

  const taskAgents = agents.filter(
    (a) => !a.scope || a.scope === "global" || a.projectPath === projectPath
  );

  const selectedAgent = taskAgents.find((a) => a.id === selectedAgentId);

  const handleAgentSave = async (config: Omit<AgentConfig, "id" | "createdAt"> | AgentConfig) => {
    if ("id" in config && config.id) {
      await updateAgent(config as AgentConfig);
    } else {
      await createAgent(config as Omit<AgentConfig, "id" | "createdAt">);
    }
  };

  const handleRunTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !taskInput.trim() || isRunning) return;
    await runTask(selectedAgent, taskInput.trim(), projectPath);
    setTaskInput("");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-semibold">{dirName}</h2>
          <p className="text-xs text-muted-foreground font-mono">{projectPath}</p>
        </div>
      </div>

      {/* Inner Tabs: Agents | Tasks */}
      <Tabs defaultValue="agents" className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-fit mb-4">
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        {/* Agents Tab */}
        <TabsContent value="agents" className="flex-1 overflow-auto mt-0">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {projectAgents.length} agent{projectAgents.length !== 1 ? "s" : ""} in this project
            </p>
            <Button
              size="sm"
              onClick={() => { setEditingAgent(undefined); setAgentFormOpen(true); }}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create Agent
            </Button>
          </div>

          {projectAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-muted-foreground mb-4">No agents yet for this project.</p>
              <Button
                size="sm"
                onClick={() => { setEditingAgent(undefined); setAgentFormOpen(true); }}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create Agent
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {projectAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onEdit={(a) => { setEditingAgent(a); setAgentFormOpen(true); }}
                  onDelete={deleteAgent}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="flex-1 min-h-0 mt-0 flex flex-col">
          {error && (
            <div className="mb-3 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleRunTask} className="space-y-3 mb-6 shrink-0">
            <div>
              <Label>Agent</Label>
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an agent..." />
                </SelectTrigger>
                <SelectContent>
                  {taskAgents.map((agent) => (
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
              {taskAgents.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No agents available. Create one in the Agents tab or add a global agent.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="pd-task">Task</Label>
              <Textarea
                id="pd-task"
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
                <Button type="submit" disabled={!selectedAgent || !taskInput.trim()}>
                  Run Task
                </Button>
              )}
            </div>
          </form>

          {results.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3 shrink-0">
                <p className="text-sm font-medium">History</p>
                <Button variant="outline" size="sm" onClick={clearResults}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Clear
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="space-y-4">
                  {[...results].reverse().map((result) => (
                    <TaskResultCard key={result.id} result={result} />
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </TabsContent>
      </Tabs>

      <AgentFormDialog
        open={agentFormOpen}
        onOpenChange={setAgentFormOpen}
        agent={editingAgent}
        onSave={handleAgentSave}
        {...(!editingAgent && { initialScope: "project", initialProjectPath: projectPath })}
      />
    </div>
  );
}
