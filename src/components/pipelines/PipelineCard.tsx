import { Pencil, Trash2, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Pipeline } from "@/types/pipeline";
import type { AgentConfig } from "@/types/agent";

interface PipelineCardProps {
  pipeline: Pipeline;
  agents: AgentConfig[];
  onEdit: (pipeline: Pipeline) => void;
  onDelete: (id: string) => void;
  onRun: (pipeline: Pipeline) => void;
}

export function PipelineCard({ pipeline, agents, onEdit, onDelete, onRun }: PipelineCardProps): React.JSX.Element {
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const agentNames = pipeline.nodes
    .map((n) => agentMap.get(n.agentId)?.name ?? "Unknown")
    .filter((name, i, arr) => arr.indexOf(name) === i); // dedupe

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{pipeline.name}</CardTitle>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(pipeline)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(pipeline.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {pipeline.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{pipeline.description}</p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{pipeline.nodes.length} agent{pipeline.nodes.length !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>{pipeline.edges.length} connection{pipeline.edges.length !== 1 ? "s" : ""}</span>
        </div>

        {agentNames.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {agentNames.slice(0, 4).map((name) => (
              <Badge key={name} variant="secondary" className="text-xs">
                {name}
              </Badge>
            ))}
            {agentNames.length > 4 && (
              <Badge variant="secondary" className="text-xs">
                +{agentNames.length - 4} more
              </Badge>
            )}
          </div>
        )}

        <Button size="sm" className="mt-auto w-full" onClick={() => onRun(pipeline)}>
          <Play className="h-3.5 w-3.5 mr-1.5" />
          Run Pipeline
        </Button>
      </CardContent>
    </Card>
  );
}
