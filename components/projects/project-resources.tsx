"use client";

import { useState } from "react";
import {
  ExternalLink,
  FileText,
  Globe,
  Link2,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { RESOURCE_TYPE_LABELS } from "@/lib/constants";
import { addProjectResource, deleteProjectResource } from "@/lib/actions/projects";
import { toast } from "sonner";
import type { ProjectResource, ResourceType } from "@/types/database";

const resourceIcons: Record<ResourceType, typeof Globe> = {
  DRIVE: Link2,
  CANVA: FileText,
  GOOGLE_DOC: FileText,
  GOOGLE_SHEET: FileText,
  WEBSITE: Globe,
  OTHER: Link2,
};

interface ProjectResourcesProps {
  projectId: string;
  resources: ProjectResource[];
  onResourcesChange: (resources: ProjectResource[]) => void;
  readOnly?: boolean;
}

export function ProjectResources({
  projectId,
  resources,
  onResourcesChange,
  readOnly = false,
}: ProjectResourcesProps) {
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType>("OTHER");

  async function handleAdd() {
    if (!title || !url) return;

    setIsAdding(true);
    const result = await addProjectResource(projectId, {
      title,
      url,
      description,
      resource_type: resourceType,
    });

    if (result.success && result.data) {
      onResourcesChange([...resources, result.data]);
      setTitle("");
      setUrl("");
      setDescription("");
      setResourceType("OTHER");
      setOpen(false);
      toast.success("Resource added");
    } else {
      toast.error(result.error || "Failed to add resource");
    }
    setIsAdding(false);
  }

  async function handleDelete(resourceId: string) {
    const result = await deleteProjectResource(resourceId);
    if (result.success) {
      onResourcesChange(resources.filter((r) => r.id !== resourceId));
      toast.success("Resource removed");
    } else {
      toast.error(result.error || "Failed to remove resource");
    }
  }

  return (
    <div className="space-y-3">
      {resources.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No resources added yet.
        </p>
      ) : (
        <div className="space-y-2">
          {resources.map((resource) => {
            const Icon = resourceIcons[resource.resource_type] || Link2;
            return (
              <div
                key={resource.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card"
              >
                <div className="p-2 rounded-md bg-muted">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sm hover:underline flex items-center gap-1"
                  >
                    {resource.title}
                    <ExternalLink className="size-3" />
                  </a>
                  {resource.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {resource.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {RESOURCE_TYPE_LABELS[resource.resource_type]}
                  </p>
                </div>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(resource.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button variant="outline" size="sm">
              <Plus className="size-4" />
              Add Resource
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Resource</DialogTitle>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel>Title *</FieldLabel>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Google Drive Assets"
                />
              </Field>
              <Field>
                <FieldLabel>URL *</FieldLabel>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                />
              </Field>
              <Field>
                <FieldLabel>Type</FieldLabel>
                <Select value={resourceType} onValueChange={(v) => setResourceType(v as ResourceType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description..."
                  rows={2}
                />
              </Field>
            </FieldGroup>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={isAdding || !title || !url}>
                {isAdding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Add Resource"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
