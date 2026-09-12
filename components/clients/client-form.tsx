"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";
import { clientSchema, type ClientInput } from "@/validators/schemas";
import { createClientAction, updateClientAction } from "@/lib/actions/clients";
import { toast } from "sonner";
import type { Client } from "@/types/database";

interface ClientFormProps {
  client?: Client;
  mode: "create" | "edit";
}

export function ClientForm({ client, mode }: ClientFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name ?? "",
      company_name: client?.company_name ?? "",
      email: client?.email ?? "",
      phone: client?.phone ?? "",
      website: client?.website ?? "",
      notes: client?.notes ?? "",
      active: client?.active ?? true,
    },
  });

  async function onSubmit(data: ClientInput) {
    setIsLoading(true);

    const result =
      mode === "create"
        ? await createClientAction(data)
        : await updateClientAction(client!.id, data);

    if (result.success) {
      toast.success(mode === "create" ? "Client created" : "Client updated");
      router.push(mode === "create" ? "/clients" : `/clients/${client?.id}`);
      router.refresh();
    } else {
      toast.error(result.error || "Something went wrong");
    }

    setIsLoading(false);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">Client Name *</FieldLabel>
          <Input
            id="name"
            placeholder="e.g. Brilliant Coaching"
            disabled={isLoading}
            {...register("name")}
          />
          <FieldError errors={errors.name ? [errors.name] : []} />
        </Field>

        <Field>
          <FieldLabel htmlFor="company_name">Company Name</FieldLabel>
          <Input
            id="company_name"
            placeholder="e.g. Brilliant Coaching Academy"
            disabled={isLoading}
            {...register("company_name")}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="contact@example.com"
              disabled={isLoading}
              {...register("email")}
            />
            <FieldError errors={errors.email ? [errors.email] : []} />
          </Field>

          <Field>
            <FieldLabel htmlFor="phone">Phone</FieldLabel>
            <Input
              id="phone"
              type="tel"
              placeholder="+91 98765 43210"
              disabled={isLoading}
              {...register("phone")}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="website">Website</FieldLabel>
          <Input
            id="website"
            type="url"
            placeholder="https://example.com"
            disabled={isLoading}
            {...register("website")}
          />
          <FieldError errors={errors.website ? [errors.website] : []} />
        </Field>

        <Field>
          <FieldLabel htmlFor="notes">Notes</FieldLabel>
          <Textarea
            id="notes"
            placeholder="Any notes about this client..."
            rows={3}
            disabled={isLoading}
            {...register("notes")}
          />
        </Field>
      </FieldGroup>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {mode === "create" ? "Creating..." : "Saving..."}
            </>
          ) : mode === "create" ? (
            "Create Client"
          ) : (
            "Save Changes"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isLoading}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
