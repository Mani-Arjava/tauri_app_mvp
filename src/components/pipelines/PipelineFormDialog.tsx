import { useState, useEffect } from "react";
import { Plus, X, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Pipeline, PipelineNode, PipelineEdge } from "@/types/pipeline";
import type { AgentConfig } from "@/types/agent";
import { detectCycle } from "@/utils/graph";
import { generateId } from "@/utils/id";

interface PipelineFormDialogProps {
  open: boolean;
  initialData: Pipeline | null;
  agents: AgentConfig[];
  onSave: (data: Omit<Pipeline, "id" | "createdAt">) => Promise<void>;
  onClose: () => void;
}

export function PipelineFormDialog({ open, initialData, agents, onSave, onClose }: PipelineFormDialogProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<PipelineNode[]>([]);
  const [edges, setEdges] = useState<PipelineEdge[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [edgeFrom, setEdgeFrom] = useState<string>("");
  const [edgeTo, setEdgeTo] = useState<string>("");
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Populate form when editing
  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setDescription(initialData.description);
      setNodes(initialData.nodes);
      setEdges(initialData.edges);
    } else {
      setName("");
      setDescription("");
      setNodes([]);
      setEdges([]);
    }
    setSelectedAgentId("");
    setEdgeFrom("");
    setEdgeTo("");
    setCycleError(null);
  }, [initialData, open]);

  const addNode = () => {
    if (!selectedAgentId) return;
    const newNode: PipelineNode = {
      id: generateId(),
      agentId: selectedAgentId,
      label: null,
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedAgentId("");
  };

  const removeNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.from !== nodeId && e.to !== nodeId));
    setCycleError(null);
  };

  const addEdge = () => {
    if (!edgeFrom || !edgeTo || edgeFrom === edgeTo) return;
    // Prevent duplicate edges
    if (edges.some((e) => e.from === edgeFrom && e.to === edgeTo)) return;

    const newEdge: PipelineEdge = { from: edgeFrom, to: edgeTo };
    const tentativeEdges = [...edges, newEdge];

    if (detectCycle(nodes, tentativeEdges)) {
      setCycleError("This connection creates a cycle. Pipelines must be acyclic.");
      return;
    }

    setCycleError(null);
    setEdges(tentativeEdges);
    setEdgeFrom("");
    setEdgeTo("");
  };

  const removeEdge = (index: number) => {
    setEdges((prev) => prev.filter((_, i) => i !== index));
    setCycleError(null);
  };

  const canSave = name.trim().length > 0 && nodes.length > 0 && !cycleError;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), nodes, edges });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const nodeLabel = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    const agent = node ? agentMap.get(node.agentId) : null;
    return node?.label ?? agent?.name ?? nodeId;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Edit Pipeline" : "Create Pipeline"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pipe-name">Name</Label>
            <Input
              id="pipe-name"
              placeholder="Research & Publish"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pipe-desc">Description</Label>
            <Textarea
              id="pipe-desc"
              placeholder="What does this pipeline do?"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <Separator />

          {/* Nodes */}
          <div className="flex flex-col gap-2">
            <Label>Agents</Label>
            {nodes.length === 0 && (
              <p className="text-xs text-muted-foreground">No agents added yet.</p>
            )}
            <div className="flex flex-col gap-1.5">
              {nodes.map((node, i) => {
                const agent = agentMap.get(node.agentId);
                return (
                  <div key={node.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                    <span className="text-muted-foreground text-xs w-5">{i + 1}.</span>
                    <span className="flex-1">{agent?.name ?? "Unknown agent"}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeNode(node.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>

            {/* Add node */}
            <div className="flex gap-2">
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="flex-1 h-8 text-sm">
                  <SelectValue placeholder="Select agent…" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-8" onClick={addNode} disabled={!selectedAgentId}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>

          <Separator />

          {/* Edges */}
          <div className="flex flex-col gap-2">
            <Label>Connections</Label>
            {edges.length === 0 && (
              <p className="text-xs text-muted-foreground">No connections yet. Add connections to define the flow.</p>
            )}
            <div className="flex flex-col gap-1.5">
              {edges.map((edge, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <Badge variant="outline" className="text-xs">{nodeLabel(edge.from)}</Badge>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Badge variant="outline" className="text-xs">{nodeLabel(edge.to)}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => removeEdge(i)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {cycleError && (
              <p className="text-xs text-destructive">{cycleError}</p>
            )}

            {/* Add edge */}
            {nodes.length >= 2 && (
              <div className="flex items-center gap-2">
                <Select value={edgeFrom} onValueChange={setEdgeFrom}>
                  <SelectTrigger className="flex-1 h-8 text-sm">
                    <SelectValue placeholder="From…" />
                  </SelectTrigger>
                  <SelectContent>
                    {nodes.map((n) => (
                      <SelectItem key={n.id} value={n.id}>{nodeLabel(n.id)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <Select value={edgeTo} onValueChange={setEdgeTo}>
                  <SelectTrigger className="flex-1 h-8 text-sm">
                    <SelectValue placeholder="To…" />
                  </SelectTrigger>
                  <SelectContent>
                    {nodes
                      .filter((n) => n.id !== edgeFrom)
                      .map((n) => (
                        <SelectItem key={n.id} value={n.id}>{nodeLabel(n.id)}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={addEdge} disabled={!edgeFrom || !edgeTo}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving ? "Saving…" : initialData ? "Save Changes" : "Create Pipeline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
