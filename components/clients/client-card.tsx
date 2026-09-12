import Link from "next/link";
import { ExternalLink, Mail, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Client } from "@/types/database";

interface ClientCardProps {
  client: Client;
}

export function ClientCard({ client }: ClientCardProps) {
  return (
    <Link href={`/clients/${client.id}`}>
      <Card className="hover:shadow-sm transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium truncate">{client.name}</h3>
              {client.company_name && (
                <p className="text-sm text-muted-foreground truncate">
                  {client.company_name}
                </p>
              )}
            </div>
            {!client.active && (
              <Badge variant="secondary" className="text-xs shrink-0">
                Inactive
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground">
            {client.email && (
              <span className="flex items-center gap-1 truncate">
                <Mail className="size-3.5 shrink-0" />
                {client.email}
              </span>
            )}
            {client.phone && (
              <span className="flex items-center gap-1 shrink-0">
                <Phone className="size-3.5" />
              </span>
            )}
            {client.website && (
              <span className="flex items-center gap-1 shrink-0">
                <ExternalLink className="size-3.5" />
              </span>
            )}
          </div>

          {client.notes && (
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
              {client.notes}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
