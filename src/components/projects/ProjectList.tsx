import { useState } from "react";
import { Plus } from "lucide-react";
import type { AgentConfig } from "@/types/agent";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "./ProjectCard";
import { AddProjectDialog } from "./AddProjectDialog";

interface ProjectListProps {
  projects: string[];
  agents: AgentConfig[];
  onSelect: (projectPath: string) => void;
  onAdd: (path: string) => Promise<void>;
}

export function ProjectList({ projects, agents, onSelect, onAdd }: ProjectListProps): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Projects</h2>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground mb-4">
            No projects yet. Add a project directory to get started.
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((projectPath) => (
            <ProjectCard
              key={projectPath}
              projectPath={projectPath}
              agents={agents}
              onClick={() => onSelect(projectPath)}
            />
          ))}
        </div>
      )}

      <AddProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={onAdd}
      />
    </div>
  );
}
