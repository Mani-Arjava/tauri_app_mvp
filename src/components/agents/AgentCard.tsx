import { useState } from "react";
import { Pencil, Trash2, FileText } from "lucide-react";
import type { AgentConfig } from "@/types/agent";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AgentCardProps {
  agent: AgentConfig;
  onEdit: (agent: AgentConfig) => void;
  onDelete: (id: string) => void;
}

function buildMarkdown(agent: AgentConfig): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`name: ${agent.name}`);
  lines.push(`description: ${agent.description}`);
  if (agent.tools.length > 0) {
    lines.push(`tools: ${agent.tools.join(", ")}`);
  }
  lines.push(`model: ${agent.model}`);
  lines.push(`color: ${agent.color}`);
  if (agent.mcpServers.length > 0) {
    lines.push("mcpServers:");
    for (const server of agent.mcpServers) {
      const cmdLine = [server.command, ...server.args].join(" ");
      lines.push(`  - name: ${server.name}`);
      lines.push(`    command: ${cmdLine}`);
      const envEntries = Object.entries(server.env ?? {});
      if (envEntries.length > 0) {
        lines.push(`    env: ${envEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(agent.systemPrompt?.trim() || "");

  return lines.join("\n").trimEnd();
}

export function AgentCard({ agent, onEdit, onDelete }: AgentCardProps): React.JSX.Element {
  const [mdOpen, setMdOpen] = useState(false);

  return (
    <>
      <Card className="relative overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ backgroundColor: agent.color }}
        />
        <CardHeader className="pl-5">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{agent.name}</CardTitle>
              <CardDescription className="line-clamp-2 mt-1">
                {agent.description}
              </CardDescription>
            </div>
            <div className="flex gap-1 ml-2 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMdOpen(true)}>
                <FileText className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(agent)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(agent.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pl-5 pt-0">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-xs">{agent.model}</Badge>
            {agent.tools.map((tool) => (
              <Badge key={tool} variant="outline" className="text-xs">{tool}</Badge>
            ))}
            {agent.mcpServers.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {agent.mcpServers.length} MCP server{agent.mcpServers.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={mdOpen} onOpenChange={setMdOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{agent.name}</DialogTitle>
            <DialogDescription>Agent definition</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh] mt-2">
            <pre className="text-sm font-mono whitespace-pre-wrap break-words p-1">
              {buildMarkdown(agent)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
