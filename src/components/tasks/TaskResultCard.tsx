import type { TaskResult } from "@/types/task";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface TaskResultCardProps {
  result: TaskResult;
}

export function TaskResultCard({ result }: TaskResultCardProps): React.JSX.Element {
  return (
    <Card className={result.error ? "border-destructive/50" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge style={{ backgroundColor: result.agentColor, color: "#fff" }}>
              {result.agentName}
            </Badge>
            <Badge variant="secondary" className="text-xs">{result.agentModel}</Badge>
            {result.agentMcpServers.map((name) => (
              <Badge key={name} variant="outline" className="text-xs">{name}</Badge>
            ))}
            {result.isStreaming && (
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute h-2 w-2 rounded-full bg-primary opacity-75" />
                <span className="relative rounded-full h-2 w-2 bg-primary" />
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(result.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{result.taskDescription}</p>
      </CardHeader>
      <CardContent>
        {result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : (
          <div className="text-sm whitespace-pre-wrap">
            {result.response || (result.isStreaming ? "Thinking..." : "No response")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
