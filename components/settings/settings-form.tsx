"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { settingsSchema, type SettingsInput } from "@/validators/schemas";
import { createClient } from "@/lib/supabase/client";
import { settingsOptions } from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";

export function SettingsForm() {
  const queryClient = useQueryClient();

  // Cached read — revisiting /settings serves cache instead of re-reading
  // the settings table (§3).
  const settingsQuery = useQuery(settingsOptions);
  const settings = settingsQuery.data;
  const isLoading = settingsQuery.isLoading;
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: {},
  } = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      agency_name: "Taskora",
      currency: "INR",
      timezone: "Asia/Kolkata",
    },
  });

  // Hydrate form defaults once cached values exist (setValue writes
  // form state only — the cache remains the single source of truth).
  useEffect(() => {
    if (!settings) return;
    if (typeof settings.agency_name === "string") {
      setValue("agency_name", settings.agency_name);
    }
    if (typeof settings.currency === "string") setValue("currency", settings.currency);
    if (typeof settings.timezone === "string") setValue("timezone", settings.timezone);
  }, [settings, setValue]);

  async function onSubmit(data: SettingsInput) {
    setIsSaving(true);
    const supabase = createClient();
    const updates = [
      { key: "agency_name", value: data.agency_name },
      { key: "currency", value: data.currency || "INR" },
      { key: "timezone", value: data.timezone || "Asia/Kolkata" },
    ];
    const { error } = await supabase
      .from("settings")
      .upsert(updates, { onConflict: "key" });
    setIsSaving(false);

    if (error) {
      toast.error("Couldn't save settings");
    } else {
      // Write the authoritative values back into the cache entry.
      queryClient.setQueryData<Record<string, unknown>>(qk.settings(), (prev) => ({
        ...(prev ?? {}),
        agency_name: data.agency_name,
        currency: data.currency || "INR",
        timezone: data.timezone || "Asia/Kolkata",
      }));
      toast.success("Settings saved");
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Settings</h1>
      <p className="-mt-4 text-sm text-muted-foreground">
        Basic agency preferences. Keep it simple.
      </p>

      <form onSubmit={handleSubmit(onSubmit)}>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="agency_name">Agency name</FieldLabel>
              <Input id="agency_name" disabled={isSaving} {...register("agency_name")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="currency">Currency</FieldLabel>
              <Input id="currency" disabled={isSaving} {...register("currency")} />
              <p className="text-xs text-muted-foreground">
                Amounts display in ₹ (INR) throughout the app.
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
              <Input id="timezone" disabled={isSaving} {...register("timezone")} />
              <p className="text-xs text-muted-foreground">
                Deadlines are stored in UTC and shown in Asia/Kolkata.
              </p>
            </Field>
          </FieldGroup>
        )}
        <Button type="submit" disabled={isSaving || isLoading} className="mt-6">
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Save settings
        </Button>
      </form>
    </div>
  );
}
