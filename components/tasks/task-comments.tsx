"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Paperclip, SendHorizontal } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { addCommentAction } from "@/lib/actions/comments";
import {
  uploadTaskAttachment,
} from "@/lib/actions/tasks";
import { getInitials, formatTime, cn } from "@/lib/utils";
import type { TaskDetail } from "@/lib/actions/tasks";

type Comment = TaskDetail["comments"][number];
type Attachment = TaskDetail["attachments"][number];

interface TaskCommentsProps {
  taskId: string;
  initialComments: Comment[];
  currentUserId: string;
  onAttachmentAdded?: (attachment: Attachment) => void;
}

/**
 * Conversation-style task communication (§13, §14).
 * Realtime scoped to this task; cleaned up on unmount (§46).
 */
export function TaskComments({
  taskId,
  initialComments,
  currentUserId,
  onAttachmentAdded,
}: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when task changes (navigating task A → B → A must not
  // duplicate subscriptions or keep stale messages)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on task switch
    setComments(initialComments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Realtime: new comments on this task only
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`task-comments:${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_comments",
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            task_id: string;
            user_id: string;
            comment: string;
            created_at: string;
          };
          // Dedupe (optimistic echo or realtime race)
          setComments((prev) => {
            if (prev.some((c) => c.id === row.id)) return prev;
            // Fetch author profile is not possible in payload;
            // realtime RLS sends only columns. We refetch lazily via
            // a lightweight profiles lookup below.
            addAuthorAndInsert(row);
            return prev;
          });
        }
      )
      .subscribe();

    async function addAuthorAndInsert(row: {
      id: string;
      task_id: string;
      user_id: string;
      comment: string;
      created_at: string;
    }) {
      const supabase2 = createClient();
      const { data: user } = await supabase2
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", row.user_id)
        .single();
      setComments((prev) => {
        if (prev.some((c) => c.id === row.id)) return prev;
        return [
          ...prev,
          {
            ...row,
            user: user ?? { id: row.user_id, full_name: "Unknown", avatar_url: null },
          },
        ];
      });
    }

    return () => {
      supabase.removeChannel(channel);
    };
  }, [taskId]);

  // Scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [comments.length]);

  async function handleSend() {
    const text = value.trim();
    if (!text || sending) return;

    setSending(true);
    // Optimistic message (§38)
    const optimistic: Comment = {
      id: `optimistic-${Date.now()}`,
      task_id: taskId,
      user_id: currentUserId,
      comment: text,
      created_at: new Date().toISOString(),
      user: { id: currentUserId, full_name: "You", avatar_url: null },
    };
    setComments((prev) => [...prev, optimistic]);
    setValue("");

    const result = await addCommentAction(taskId, text);

    if (result.success && result.data) {
      // Replace optimistic with the real row
      setComments((prev) =>
        prev.map((c) => (c.id === optimistic.id ? result.data! : c))
      );
    } else {
      // Roll back
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      setValue(text);
      toast.error(result.error ?? "Couldn't send your message");
    }
    setSending(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a newline (§13)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadingFile(true);
    const result = await uploadTaskAttachment(taskId, file);
    setUploadingFile(false);

    if (result.success && result.data) {
      onAttachmentAdded?.({
        id: result.data.id,
        file_name: result.data.file_name,
        file_path: result.data.file_path,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: currentUserId,
        created_at: new Date().toISOString(),
      });
    } else {
      toast.error(result.error ?? "Couldn't upload the file");
    }
  }

  return (
    <div className="flex flex-col">
      {/* Messages */}
      <div className="space-y-4">
        {comments.length === 0 && (
          <p className="py-2 text-center text-[13px] text-muted-foreground">
            No messages yet. Say hi or ask a question.
          </p>
        )}
        {comments.map((c) => {
          const own = c.user_id === currentUserId;
          const isOptimistic = c.id.startsWith("optimistic-");
          return (
            <div
              key={c.id}
              className={cn("flex gap-2.5", own && "flex-row-reverse")}
            >
              <Avatar className="size-7 shrink-0">
                <AvatarFallback className="text-[10px]">
                  {getInitials(c.user.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 max-w-[80%]", own && "text-right")}>
                <p className="text-xs text-muted-foreground">
                  {own ? "You" : c.user.full_name}
                  <span className="mx-1.5">·</span>
                  {formatTime(c.created_at)}
                  {isOptimistic && <span className="ml-1">· sending…</span>}
                </p>
                <div
                  className={cn(
                    "mt-1 inline-block whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                    own
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md bg-muted text-foreground",
                    isOptimistic && "opacity-70"
                  )}
                >
                  {c.comment}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="sticky bottom-0 mt-4 flex items-end gap-2 border-t bg-background pt-3">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelected}
          accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4,.mov,.zip,.txt,.docx,.xlsx,.pptx"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingFile}
          aria-label="Attach a file"
        >
          {uploadingFile ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
        </Button>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a message…"
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
          disabled={sending}
        />
        <Button
          type="button"
          size="icon"
          className="size-9 shrink-0"
          onClick={handleSend}
          disabled={sending || !value.trim()}
          aria-label="Send message"
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizontal className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
