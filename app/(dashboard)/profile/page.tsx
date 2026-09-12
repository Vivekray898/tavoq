"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";
import { PageHeader } from "@/components/shared/page-header";
import { SkeletonPage } from "@/components/shared/skeleton-loader";
import { profileSchema, type ProfileInput } from "@/validators/schemas";
import { createClient } from "@/lib/supabase/client";
import { getInitials, formatDate } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/constants";
import { toast } from "sonner";
import type { Profile } from "@/types/database";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (data) {
          setProfile(data as Profile);
        }
      }
      setLoading(false);
    }
    loadProfile();
  }, []);

  async function onSubmit(data: ProfileInput) {
    if (!profile) return;

    setIsSaving(true);
    const supabase = createClient();

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: data.full_name,
        phone: data.phone || null,
        avatar_url: data.avatar_url || null,
      })
      .eq("id", profile.id);

    if (error) {
      toast.error("Failed to update profile");
    } else {
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              full_name: data.full_name,
              phone: data.phone || null,
              avatar_url: data.avatar_url || null,
            }
          : prev
      );
      toast.success("Profile updated");
    }
    setIsSaving(false);
  }

  if (loading) return <SkeletonPage />;
  if (!profile) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Profile"
        description="Manage your account settings"
      />

      {/* Profile Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarFallback className="text-lg">
                {getInitials(profile.full_name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-xl font-bold">{profile.full_name}</h2>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {ROLE_LABELS[profile.role]} · Joined {formatDate(profile.created_at)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="size-4" />
            Edit Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Full Name</FieldLabel>
                <Input
                  defaultValue={profile.full_name}
                  disabled={isSaving}
                  {...register("full_name")}
                />
                <FieldError errors={errors.full_name ? [errors.full_name] : []} />
              </Field>

              <Field>
                <FieldLabel>Phone</FieldLabel>
                <Input
                  type="tel"
                  defaultValue={profile.phone ?? ""}
                  placeholder="+91 98765 43210"
                  disabled={isSaving}
                  {...register("phone")}
                />
              </Field>
            </FieldGroup>

            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
