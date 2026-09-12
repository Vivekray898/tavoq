"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { PageHeader } from "@/components/shared/page-header";
import { settingsSchema, type SettingsInput } from "@/validators/schemas";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: {},
  } = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      agency_name: "Taskora Agency",
      currency: "INR",
      timezone: "Asia/Kolkata",
    },
  });

  useEffect(() => {
    async function loadSettings() {
      const supabase = createClient();
      const { data } = await supabase.from("settings").select("*");

      if (data) {
        const settings = data.reduce(
          (acc: Record<string, string>, row: { key: string; value: string }) => {
            acc[row.key] = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
            return acc;
          },
          {} as Record<string, string>
        );

        if (settings.agency_name) setValue("agency_name", settings.agency_name);
        if (settings.currency) setValue("currency", settings.currency);
        if (settings.timezone) setValue("timezone", settings.timezone);
      }
      setIsLoading(false);
    }
    loadSettings();
  }, [setValue]);

  async function onSubmit(data: SettingsInput) {
    setIsSaving(true);

    const supabase = createClient();
    const updates = [
      { key: "agency_name", value: JSON.stringify(data.agency_name) },
      { key: "currency", value: JSON.stringify(data.currency || "INR") },
      { key: "timezone", value: JSON.stringify(data.timezone || "Asia/Kolkata") },
    ];

    const { error } = await supabase
      .from("settings")
      .upsert(updates, { onConflict: "key" });

    if (error) {
      toast.error("Failed to save settings");
    } else {
      toast.success("Settings saved");
    }
    setIsSaving(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your agency settings"
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="size-4" />
            Agency Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <FieldGroup>
                <Field>
                  <FieldLabel>Agency Name</FieldLabel>
                  <Input
                    placeholder="Your Agency Name"
                    disabled={isSaving}
                    {...register("agency_name")}
                  />
                </Field>

                <Field>
                  <FieldLabel>Currency</FieldLabel>
                  <Select
                    value={watch("currency") ?? "INR"}
                    onValueChange={(v) => { if (v) setValue("currency", v); }}
                    disabled={isSaving}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INR">INR (₹)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                      <SelectItem value="GBP">GBP (£)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>Timezone</FieldLabel>
                  <Select
                    value={watch("timezone") ?? "Asia/Kolkata"}
                    onValueChange={(v) => { if (v) setValue("timezone", v); }}
                    disabled={isSaving}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Asia/Kolkata">Asia/Kolkata (IST)</SelectItem>
                      <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                      <SelectItem value="America/Los_Angeles">America/Los_Angeles (PST)</SelectItem>
                      <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>

              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Settings"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
