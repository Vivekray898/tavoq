"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, LogOut, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { profileSchema, type ProfileInput } from "@/validators/schemas";
import { createClient } from "@/lib/supabase/client";
import { getInitials, formatDate } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/constants";
import type { Profile } from "@/types/database";

interface Prefs {
  task_assigned?: boolean;
  revision_requested?: boolean;
  task_approved?: boolean;
  payment_paid?: boolean;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        if (data) {
          setProfile(data as Profile);
          setPrefs(((data as Profile).notification_prefs ?? {}) as Prefs);
          reset({
            full_name: data.full_name,
            phone: data.phone ?? "",
          });
        }
      }
      setLoading(false);
    })();
  }, [reset]);

  async function onSubmit(data: ProfileInput) {
    if (!profile) return;
    setIsSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: data.full_name,
        phone: data.phone || null,
      })
      .eq("id", profile.id);
    setIsSaving(false);

    if (error) {
      toast.error("Couldn't update your profile");
    } else {
      setProfile((prev) =>
        prev ? { ...prev, full_name: data.full_name, phone: data.phone || null } : prev
      );
      toast.success("Profile updated");
    }
  }

  async function updatePref(key: keyof Prefs, value: boolean) {
    if (!profile) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ notification_prefs: next })
      .eq("id", profile.id);

    if (error) {
      setPrefs(prefs);
      toast.error("Couldn't update notification preferences");
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="space-y-4 py-1">
        <div className="h-16 w-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  if (!profile) return null;

  const prefRows: Array<{ key: keyof Prefs; label: string; description: string }> = [
    { key: "task_assigned", label: "Task assignments", description: "When you're assigned a new task" },
    { key: "revision_requested", label: "Revision requests", description: "When a task is sent back to you" },
    { key: "task_approved", label: "Approvals", description: "When your work is approved" },
    { key: "payment_paid", label: "Payment notifications", description: "When a payout is marked as paid" },
  ];

  return (
    <div className="max-w-xl space-y-8">
      <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">Profile</h1>

      {/* Identity */}
      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="text-lg">
            {getInitials(profile.full_name)}
          </AvatarFallback>
        </Avatar>
        <div>
          <h2 className="font-semibold">{profile.full_name}</h2>
          <p className="text-sm text-muted-foreground">{profile.email}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {profile.role ? ROLE_LABELS[profile.role] : "Pending"} · Joined {formatDate(profile.created_at)}
          </p>
        </div>
      </div>

      {/* Edit */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="full_name">Full name</FieldLabel>
            <Input id="full_name" disabled={isSaving} {...register("full_name")} />
            {errors.full_name && <FieldError errors={[errors.full_name]} />}
          </Field>
          <Field>
            <FieldLabel htmlFor="phone">Phone</FieldLabel>
            <Input
              id="phone"
              type="tel"
              placeholder="+91 98765 43210"
              disabled={isSaving}
              {...register("phone")}
            />
          </Field>
        </FieldGroup>
        <Button type="submit" disabled={isSaving}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Save changes
        </Button>
      </form>

      {/* Email notification preferences (§62) */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Mail className="size-4" /> Email notifications
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          In-app and realtime notifications are always on.
        </p>
        <div className="divide-y rounded-xl border bg-card">
          {prefRows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div>
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.description}</p>
              </div>
              <Switch
                checked={prefs[row.key] !== false}
                onCheckedChange={(checked) => updatePref(row.key, checked)}
                aria-label={`${row.label} email notifications`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Sign out */}
      <Button
        variant="outline"
        className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={handleSignOut}
        disabled={isSigningOut}
      >
        <LogOut className="size-4" />
        {isSigningOut ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
