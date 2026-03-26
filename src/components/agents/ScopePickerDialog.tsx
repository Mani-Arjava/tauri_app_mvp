import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Globe, FolderOpen, FolderSearch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ScopePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (scope: "global" | "project", projectPath: string | null) => void;
}

export function ScopePickerDialog({
  open: isOpen,
  onOpenChange,
  onConfirm,
}: ScopePickerDialogProps): React.JSX.Element {
  const [scope, setScope] = useState<"global" | "project">("global");
  const [projectPath, setProjectPath] = useState("");

  // Reset state whenever the dialog opens fresh
  useEffect(() => {
    if (isOpen) {
      setScope("global");
      setProjectPath("");
    }
  }, [isOpen]);

  const handleBrowse = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setProjectPath(selected);
    }
  };

  const handleConfirm = () => {
    onConfirm(scope, scope === "project" ? projectPath.trim() : null);
  };

  const canConfirm = scope === "global" || projectPath.trim().length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose Agent Scope</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <button
            type="button"
            onClick={() => setScope("global")}
            className={cn(
              "w-full flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-colors",
              scope === "global"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40"
            )}
          >
            <Globe className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">Global</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Available in all projects and the Run Task tab.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setScope("project")}
            className={cn(
              "w-full flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-colors",
              scope === "project"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40"
            )}
          >
            <FolderOpen className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">Project</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Only visible when that project directory is selected.
              </p>
            </div>
          </button>

          {scope === "project" && (
            <div className="space-y-1.5 pt-1">
              <Label>Project Directory</Label>
              <div className="flex gap-2">
                <Input
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="/path/to/your/project"
                  className="font-mono text-sm"
                />
                <Button type="button" variant="outline" size="icon" onClick={handleBrowse}>
                  <FolderSearch className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
