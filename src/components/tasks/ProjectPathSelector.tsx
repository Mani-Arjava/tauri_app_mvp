import { open } from "@tauri-apps/plugin-dialog";
import { FolderSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProjectPathSelectorProps {
  value: string | null;
  onChange: (path: string | null) => void;
}

export function ProjectPathSelector({
  value,
  onChange,
}: ProjectPathSelectorProps): React.JSX.Element {
  const handleBrowse = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      onChange(selected);
    }
  };

  return (
    <div className="space-y-1.5 p-4 rounded-lg border bg-muted/30">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Project Directory
      </Label>
      <div className="flex gap-2">
        <Input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="No project selected — showing global agents only"
          className="font-mono text-sm"
        />
        <Button type="button" variant="outline" size="icon" onClick={handleBrowse}>
          <FolderSearch className="h-4 w-4" />
        </Button>
        {value && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {value
          ? "Showing global agents and agents for this project."
          : "Select a project to also see project-specific agents."}
      </p>
    </div>
  );
}
