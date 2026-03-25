import { useState } from "react";
import { Plus } from "lucide-react";
import type { AgentConfig } from "@/types/agent";
import { Button } from "@/components/ui/button";
import { AgentCard } from "./AgentCard";
import { AgentFormDialog } from "./AgentFormDialog";

interface AgentListProps {
  agents: AgentConfig[];
  isLoading: boolean;
  error: string | null;
  createAgent: (config: Omit<AgentConfig, "id" | "createdAt">) => Promise<AgentConfig>;
  updateAgent: (config: AgentConfig) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

export function AgentList({
  agents,
  isLoading,
  error,
  createAgent,
  updateAgent,
  deleteAgent,
}: AgentListProps): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | undefined>();

  const handleCreate = () => {
    setEditingAgent(undefined);
    setFormOpen(true);
  };

  const handleEdit = (agent: AgentConfig) => {
    setEditingAgent(agent);
    setFormOpen(true);
  };

  const handleSave = async (config: Omit<AgentConfig, "id" | "createdAt"> | AgentConfig) => {
    if ("id" in config && config.id) {
      await updateAgent(config as AgentConfig);
    } else {
      await createAgent(config as Omit<AgentConfig, "id" | "createdAt">);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading agents...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">My Agents</h2>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Agent
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
          {error}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground mb-4">
            No agents yet. Create your first agent to get started.
          </p>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create Agent
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onEdit={handleEdit}
              onDelete={deleteAgent}
            />
          ))}
        </div>
      )}

      <AgentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        agent={editingAgent}
        onSave={handleSave}
      />
    </div>
  );
}
