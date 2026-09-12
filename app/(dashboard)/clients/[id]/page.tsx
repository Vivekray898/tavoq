"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Mail,
  Phone,
  Globe,
  FolderKanban,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { ErrorMessage } from "@/components/shared/error-message";
import { getClient, deleteClientAction } from "@/lib/actions/clients";
import { toast } from "sonner";
import type { Client } from "@/types/database";

export default function ClientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const result = await getClient(clientId);
      if (result.success && result.data) {
        setClient(result.data);
      } else {
        setError(result.error || "Client not found");
      }
      setLoading(false);
    }
    load();
  }, [clientId]);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this client? This action cannot be undone.")) {
      return;
    }

    setIsDeleting(true);
    const result = await deleteClientAction(clientId);

    if (result.success) {
      toast.success("Client deleted");
      router.push("/clients");
    } else {
      toast.error(result.error || "Failed to delete client");
    }
    setIsDeleting(false);
  }

  if (loading) return <SkeletonPage />;
  if (error || !client) {
    return <ErrorMessage message={error || "Client not found"} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <PageHeader
          title={client.name}
          description={client.company_name || undefined}
          actions={
            <div className="flex items-center gap-2">
              <Link href={`/clients/${client.id}/edit`}>
                <Button variant="outline" size="sm">
                  <Pencil className="size-4" />
                  Edit
                </Button>
              </Link>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete
              </Button>
            </div>
          }
        />
      </div>

      {/* Contact Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {client.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-muted-foreground" />
              <a
                href={`mailto:${client.email}`}
                className="hover:underline"
              >
                {client.email}
              </a>
            </div>
          )}
          {client.phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="size-4 text-muted-foreground" />
              <a
                href={`tel:${client.phone}`}
                className="hover:underline"
              >
                {client.phone}
              </a>
            </div>
          )}
          {client.website && (
            <div className="flex items-center gap-2 text-sm">
              <Globe className="size-4 text-muted-foreground" />
              <a
                href={client.website}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline flex items-center gap-1"
              >
                {client.website}
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          {client.notes && (
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground">{client.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Projects */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FolderKanban className="size-4" />
            Projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* TODO: Fetch and display projects for this client */}
          <p className="text-sm text-muted-foreground text-center py-4">
            No projects yet. Create a project for this client.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
