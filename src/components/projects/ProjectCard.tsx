import { FolderOpen } from "lucide-react";
import type { AgentConfig } from "@/types/agent";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ProjectCardProps {
  projectPath: string;
  agents: AgentConfig[];
  onClick: () => void;
}

export function ProjectCard({ projectPath, agents, onClick }: ProjectCardProps): React.JSX.Element {
  const dirName = projectPath.split("/").filter(Boolean).pop() ?? projectPath;
  const agentCount = agents.filter((a) => a.projectPath === projectPath).length;

  return (
    <Card
      className="relative overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <FolderOpen className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{dirName}</CardTitle>
            <CardDescription className="text-xs font-mono truncate mt-0.5">
              {projectPath}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {agentCount} agent{agentCount !== 1 ? "s" : ""}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
