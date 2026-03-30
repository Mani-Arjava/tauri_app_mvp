import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PipelineCard } from "./PipelineCard";
import { PipelineFormDialog } from "./PipelineFormDialog";
import { PipelineRunner } from "./PipelineRunner";
import { usePipelines } from "@/hooks/usePipelines";
import type { Pipeline } from "@/types/pipeline";
import type { AgentConfig } from "@/types/agent";

interface PipelineListProps {
  agents: AgentConfig[];
  projectPath: string | null;
}

export function PipelineList({ agents, projectPath }: PipelineListProps): React.JSX.Element {
  const { pipelines, isLoading, error, createPipeline, updatePipeline, deletePipeline } = usePipelines();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [runningPipeline, setRunningPipeline] = useState<Pipeline | null>(null);

  if (runningPipeline) {
    return (
      <PipelineRunner
        pipeline={runningPipeline}
        agents={agents}
        projectPath={projectPath}
        onBack={() => setRunningPipeline(null)}
      />
    );
  }

  const openCreate = () => {
    setEditingPipeline(null);
    setDialogOpen(true);
  };

  const openEdit = (pipeline: Pipeline) => {
    setEditingPipeline(pipeline);
    setDialogOpen(true);
  };

  const handleSave = async (data: Omit<Pipeline, "id" | "createdAt">) => {
    if (editingPipeline) {
      await updatePipeline({ ...editingPipeline, ...data });
    } else {
      await createPipeline(data);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pipelines</h2>
          <p className="text-sm text-muted-foreground">Chain multiple agents together to automate workflows.</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Create Pipeline
        </Button>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!isLoading && pipelines.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-muted-foreground text-sm">No pipelines yet.</p>
          <p className="text-muted-foreground text-xs">Create a pipeline to chain agents together.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create your first pipeline
          </Button>
        </div>
      )}

      {pipelines.length > 0 && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {pipelines.map((pipeline) => (
            <PipelineCard
              key={pipeline.id}
              pipeline={pipeline}
              agents={agents}
              onEdit={openEdit}
              onDelete={deletePipeline}
              onRun={setRunningPipeline}
            />
          ))}
        </div>
      )}

      <PipelineFormDialog
        open={dialogOpen}
        initialData={editingPipeline}
        agents={agents}
        onSave={handleSave}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
