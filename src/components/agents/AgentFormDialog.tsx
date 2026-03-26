import { useState, useEffect } from "react";
import type { AgentConfig, McpServerConfig } from "@/types/agent";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { McpServerFields } from "./McpServerFields";

const MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];

const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#06B6D4", "#6366F1",
];

interface AgentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: AgentConfig;
  onSave: (config: Omit<AgentConfig, "id" | "createdAt"> | AgentConfig) => Promise<void>;
}

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    tools: "",
    model: MODELS[0],
    mcpServers: [],
    color: COLORS[0],
    systemPrompt: "",
  };
}

interface FormState {
  name: string;
  description: string;
  tools: string;
  model: string;
  mcpServers: McpServerConfig[];
  color: string;
  systemPrompt: string;
}

export function AgentFormDialog({
  open,
  onOpenChange,
  agent,
  onSave,
}: AgentFormDialogProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (agent) {
        setForm({
          name: agent.name,
          description: agent.description,
          tools: agent.tools.join(", "),
          model: agent.model,
          mcpServers: agent.mcpServers,
          color: agent.color,
          systemPrompt: agent.systemPrompt,
        });
      } else {
        setForm(emptyForm());
      }
    }
  }, [open, agent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    setIsSaving(true);
    try {
      const config = {
        ...(agent ? { id: agent.id, createdAt: agent.createdAt } : {}),
        name: form.name.trim(),
        description: form.description.trim(),
        tools: form.tools.split(",").map((t) => t.trim()).filter(Boolean),
        model: form.model,
        mcpServers: form.mcpServers,
        color: form.color,
        systemPrompt: form.systemPrompt.trim(),
      };
      await onSave(config as Omit<AgentConfig, "id" | "createdAt"> | AgentConfig);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit Agent" : "Create Agent"}</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[65vh] -mx-6 px-6">
          <form id="agent-form" onSubmit={handleSubmit} className="space-y-4 pb-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Weather Assistant"
                required
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="A helpful weather assistant that..."
                rows={2}
              />
            </div>

            <div>
              <Label htmlFor="model">Model</Label>
              <Select value={form.model} onValueChange={(v) => setForm((f) => ({ ...f, model: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="tools">Tools (comma-separated)</Label>
              <Input
                id="tools"
                value={form.tools}
                onChange={(e) => setForm((f) => ({ ...f, tools: e.target.value }))}
                placeholder="brave-search, code-interpreter"
              />
            </div>

            <div>
              <Label>Color</Label>
              <div className="flex gap-2 mt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${
                      form.color === c ? "border-foreground scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                  />
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="systemPrompt">System Prompt</Label>
              <Textarea
                id="systemPrompt"
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="Describe what this agent should do and how it should respond. Be specific — e.g. 'Translate all input to English. Output ONLY the translation, no greeting or explanation.'"
                rows={5}
              />
            </div>

            <Separator />

            <McpServerFields
              servers={form.mcpServers}
              onChange={(servers) => setForm((f) => ({ ...f, mcpServers: servers }))}
            />
          </form>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="agent-form" disabled={isSaving || !form.name.trim()}>
            {isSaving ? "Saving..." : agent ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
