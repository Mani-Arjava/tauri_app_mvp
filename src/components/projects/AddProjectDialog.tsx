import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderSearch } from "lucide-react";
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

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (path: string) => Promise<void>;
}

export function AddProjectDialog({
  open: isOpen,
  onOpenChange,
  onAdd,
}: AddProjectDialogProps): React.JSX.Element {
  const [path, setPath] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setPath("");
  }, [isOpen]);

  const handleBrowse = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setPath(selected);
  };

  const handleAdd = async () => {
    if (!path.trim()) return;
    setIsSaving(true);
    try {
      await onAdd(path.trim());
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label>Project Directory</Label>
          <div className="flex gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/your/project"
              className="font-mono text-sm"
            />
            <Button type="button" variant="outline" size="icon" onClick={handleBrowse}>
              <FolderSearch className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!path.trim() || isSaving}>
            {isSaving ? "Adding..." : "Add Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
