import { Plus, X } from "lucide-react";
import type { McpServerConfig } from "@/types/agent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface McpServerFieldsProps {
  servers: McpServerConfig[];
  onChange: (servers: McpServerConfig[]) => void;
}

function emptyServer(): McpServerConfig {
  return { name: "", command: "", args: [], env: {} };
}

export function McpServerFields({ servers, onChange }: McpServerFieldsProps): React.JSX.Element {
  const addServer = () => {
    onChange([...servers, emptyServer()]);
  };

  const removeServer = (index: number) => {
    onChange(servers.filter((_, i) => i !== index));
  };

  const updateServer = (index: number, field: keyof McpServerConfig, value: string) => {
    const updated = servers.map((s, i) => {
      if (i !== index) return s;
      if (field === "args") {
        return { ...s, args: value.split(",").map((a) => a.trim()).filter(Boolean) };
      }
      return { ...s, [field]: value };
    });
    onChange(updated);
  };

  const addEnvVar = (index: number) => {
    const updated = servers.map((s, i) => {
      if (i !== index) return s;
      return { ...s, env: { ...s.env, "": "" } };
    });
    onChange(updated);
  };

  const updateEnvVar = (serverIndex: number, oldKey: string, newKey: string, newValue: string) => {
    const updated = servers.map((s, i) => {
      if (i !== serverIndex) return s;
      const env = { ...s.env };
      if (oldKey !== newKey) {
        delete env[oldKey];
      }
      env[newKey] = newValue;
      return { ...s, env };
    });
    onChange(updated);
  };

  const removeEnvVar = (serverIndex: number, key: string) => {
    const updated = servers.map((s, i) => {
      if (i !== serverIndex) return s;
      const env = { ...s.env };
      delete env[key];
      return { ...s, env };
    });
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>MCP Servers</Label>
        <Button type="button" variant="outline" size="sm" onClick={addServer}>
          <Plus className="h-3 w-3 mr-1" />
          Add Server
        </Button>
      </div>

      {servers.map((server, idx) => (
        <div key={idx} className="border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Server {idx + 1}</span>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeServer(idx)}>
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={server.name}
                onChange={(e) => updateServer(idx, "name", e.target.value)}
                placeholder="brave-search"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Command</Label>
              <Input
                value={server.command}
                onChange={(e) => updateServer(idx, "command", e.target.value)}
                placeholder="npx"
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Args (comma-separated)</Label>
            <Input
              value={server.args.join(", ")}
              onChange={(e) => updateServer(idx, "args", e.target.value)}
              placeholder="-y, @modelcontextprotocol/server-brave-search"
              className="h-8 text-sm"
            />
          </div>

          <Separator />

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Environment Variables</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => addEnvVar(idx)}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {Object.entries(server.env).map(([key, value]) => (
              <div key={key} className="flex gap-1 items-center">
                <Input
                  value={key}
                  onChange={(e) => updateEnvVar(idx, key, e.target.value, value)}
                  placeholder="KEY"
                  className="h-7 text-xs flex-1"
                />
                <Input
                  value={value}
                  onChange={(e) => updateEnvVar(idx, key, key, e.target.value)}
                  placeholder="value"
                  className="h-7 text-xs flex-1"
                />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeEnvVar(idx, key)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {servers.length === 0 && (
        <p className="text-sm text-muted-foreground">No MCP servers configured.</p>
      )}
    </div>
  );
}
