import { useState } from "react";
import { Streamdown } from "streamdown";
import { mermaid } from "@streamdown/mermaid";
import { ArrowLeft, ArrowRight, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Pipeline } from "@/types/pipeline";
import type { AgentConfig } from "@/types/agent";
import type { PipelineNodeState } from "@/types/pipeline";
import { usePipelineRunner } from "@/hooks/usePipelineRunner";

interface PipelineRunnerProps {
  pipeline: Pipeline;
  agents: AgentConfig[];
  projectPath: string | null;
  onBack: () => void;
}

const STATUS_BADGE: Record<PipelineNodeState["status"], { label: string; class: string }> = {
  pending:  { label: "Pending",  class: "bg-muted text-muted-foreground" },
  running:  { label: "Running",  class: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  done:     { label: "Done",     class: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  error:    { label: "Error",    class: "bg-destructive/15 text-destructive" },
};

export function PipelineRunner({ pipeline, agents, projectPath, onBack }: PipelineRunnerProps): React.JSX.Element {
  const [input, setInput] = useState("");
  const { nodeStates, isRunning, error, runPipeline, cancelRun, resetRun } = usePipelineRunner();
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const hasRun = Object.keys(nodeStates).length > 0;

  const handleRun = () => {
    resetRun();
    runPipeline(pipeline, agents, input, projectPath);
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-base font-semibold">{pipeline.name}</h2>
          {pipeline.description && (
            <p className="text-xs text-muted-foreground">{pipeline.description}</p>
          )}
        </div>
      </div>

      {/* Pipeline flow preview */}
      <div className="flex items-center flex-wrap gap-1.5 shrink-0">
        {pipeline.nodes.map((node, i) => {
          const agent = agentMap.get(node.agentId);
          const state = nodeStates[node.id];
          const statusInfo = state ? STATUS_BADGE[state.status] : null;
          return (
            <div key={node.id} className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: agent?.color ?? "#888" }}
                />
                <span>{node.label ?? agent?.name ?? "Unknown"}</span>
                {statusInfo && (
                  <span className={cn("text-xs rounded px-1 py-0.5 font-medium", statusInfo.class)}>
                    {statusInfo.label}
                  </span>
                )}
                {state?.status === "running" && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                  </span>
                )}
              </div>
              {i < pipeline.nodes.length - 1 && (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="flex flex-col gap-2 shrink-0">
        <Textarea
          placeholder="Enter your task or input for the pipeline…"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isRunning}
          className="resize-none"
        />
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={handleRun}
            disabled={isRunning || !input.trim()}
          >
            <Play className="h-4 w-4 mr-2" />
            Run Pipeline
          </Button>
          {isRunning && (
            <Button variant="outline" onClick={cancelRun}>
              <Square className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Node outputs */}
      {hasRun && (
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-3 pr-2">
            {pipeline.nodes.map((node) => {
              const agent = agentMap.get(node.agentId);
              const state = nodeStates[node.id];
              if (!state) return null;
              const statusInfo = STATUS_BADGE[state.status];

              return (
                <div key={node.id} className="rounded-lg border">
                  {/* Node header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-lg">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: agent?.color ?? "#888" }}
                    />
                    <span className="text-sm font-medium flex-1">
                      {node.label ?? agent?.name ?? "Unknown"}
                    </span>
                    <span className={cn("text-xs rounded px-1.5 py-0.5 font-medium", statusInfo.class)}>
                      {statusInfo.label}
                    </span>
                  </div>

                  {/* Node output */}
                  <div className="px-3 py-2">
                    {state.status === "pending" && (
                      <p className="text-xs text-muted-foreground italic">Waiting…</p>
                    )}
                    {state.status === "running" && !state.output && (
                      <p className="text-xs text-muted-foreground italic">Thinking…</p>
                    )}
                    {state.output && (
                      <div className="text-sm">
                        <Streamdown animated isAnimating={state.status === "running"} plugins={{ mermaid }}>
                          {state.output}
                        </Streamdown>
                      </div>
                    )}
                    {state.status === "error" && state.error && (
                      <p className="text-xs text-destructive mt-1">{state.error}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
