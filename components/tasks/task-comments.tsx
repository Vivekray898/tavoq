"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Send, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { commentSchema, type CommentInput } from "@/validators/schemas";
import { createClient } from "@/lib/supabase/client";
import { getInitials, getRelativeTime } from "@/lib/utils";
import { toast } from "sonner";

interface Comment {
  id: string;
  comment: string;
  created_at: string;
  user: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  };
}

interface TaskCommentsProps {
  taskId: string;
  comments: Comment[];
  currentUserId: string;
  onCommentAdded: (comment: Comment) => void;
}

export function TaskComments({
  taskId,
  comments,
  currentUserId,
  onCommentAdded,
}: TaskCommentsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CommentInput>({
    resolver: zodResolver(commentSchema),
  });

  async function onSubmit(data: CommentInput) {
    setIsSubmitting(true);

    const supabase = createClient();
    const { data: newComment, error } = await supabase
      .from("task_comments")
      .insert({
        task_id: taskId,
        user_id: currentUserId,
        comment: data.comment,
      })
      .select("*, user:profiles(id, full_name, avatar_url)")
      .single();

    if (error) {
      toast.error("Failed to add comment");
      setIsSubmitting(false);
      return;
    }

    onCommentAdded(newComment as Comment);
    reset();
    setIsSubmitting(false);
  }

  return (
    <div className="space-y-4">
      {/* Comment List */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No comments yet. Start the conversation.
          </p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="text-xs">
                  {getInitials(comment.user.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {comment.user.full_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {getRelativeTime(comment.created_at)}
                  </span>
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap">
                  {comment.comment}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Comment Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="flex gap-2">
        <Textarea
          placeholder="Write a comment..."
          rows={2}
          disabled={isSubmitting}
          className="flex-1 resize-none"
          {...register("comment")}
        />
        <Button
          type="submit"
          size="icon"
          disabled={isSubmitting}
          className="shrink-0 self-end"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </form>
      {errors.comment && (
        <p className="text-xs text-destructive">{errors.comment.message}</p>
      )}
    </div>
  );
}
