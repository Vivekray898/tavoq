"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Paperclip, SendHorizontal } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { addCommentAction } from "@/lib/actions/comments";
import { uploadTaskAttachment } from "@/lib/actions/tasks";
import { taskDetailOptions } from "@/lib/queries/options";
import { qk } from "@/lib/queries/keys";
import { getInitials, formatTime, cn } from "@/lib/utils";
import type { TaskDetail } from "@/lib/actions/tasks";

type Comment = TaskDetail["comments"][number];
type Attachment = TaskDetail["attachments"][number];

interface TaskCommentsProps {
  taskId: string;
  initialComments: Comment[];
  currentUserId: string;
  onAttachmentAdded?: (attachment: Attachment) => void;
  /** Max height of the scrollable message area. */
  heightClassName?: string;
}

/**
 * Conversation-style task communication (§13, §14).
 *
 * Messages are read from the shared task-detail cache — realtime INSERTs
 * land there via the session RealtimeProvider, so this component owns no
 * subscription and no mirror state (§8). Local state holds only the
 * optimistic in-flight message; failures roll it back (§24).
 *
 * Messages live inside a fixed-height scroll region so a long thread
 * never pushes the page around, and the composer stays pinned below it.
 */
export function TaskComments({
  taskId,
  initialComments,
  currentUserId,
  onAttachmentAdded,
  heightClassName = "h-80",
}: TaskCommentsProps) {
  const queryClient = useQueryClient();

  // Observes the same cache entry the page rendered from — no extra
  // fetch, and realtime comments appear here instantly.
  const taskQuery = useQuery(taskDetailOptions(taskId));
  const serverComments = taskQuery.data?.comments ?? initialComments;

  // Optimistic in-flight messages only.
  const [pending, setPending] = useState<Comment[]>([]);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Dedupe by id — realtime + optimistic updates can deliver the same
  // row twice (same protection the server query applies).
  const seen = new Set<string>();
  const comments: Comment[] = [];
  for (const c of [...serverComments, ...pending]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    comments.push(c);
  }

  // Scroll to newest message inside the scroll container only.
  // (DOM-only effect: no React state is written here.)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [comments.length]);

  async function handleSend() {
    const text = value.trim();
    if (!text || sending) return;

    setSending(true);
    const optimisticId = `optimistic-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const optimistic: Comment = {
      id: optimisticId,
      task_id: taskId,
      user_id: currentUserId,
      comment: text,
      created_at: new Date().toISOString(),
      user: { id: currentUserId, full_name: "You", avatar_url: null },
    };
    setPending((prev) => [...prev, optimistic]);
    setValue("");

    const result = await addCommentAction(taskId, text);

    if (result.success && result.data) {
      const real = result.data;
      setPending((prev) => prev.filter((c) => c.id !== optimisticId));
      // Mirror into the shared cache (dedupe against the realtime copy).
      queryClient.setQueryData<TaskDetail>(qk.taskDetail(taskId), (prev) =>
        prev
          ? {
              ...prev,
              comments: [...prev.comments.filter((c) => c.id !== real.id), real].sort(
                (a, b) =>
                  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              ),
              comments_count: prev.comments_count + 1,
            }
          : prev
      );
    } else {
      // Roll back the optimistic message — never fake success (§24).
      setPending((prev) => prev.filter((c) => c.id !== optimisticId));
      setValue(text);
      toast.error(result.error ?? "Couldn't send your message");
    }
    setSending(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Scrollable messages */}
      <div
        ref={scrollRef}
        className={cn(
          "overflow-y-auto px-4 py-4",
          heightClassName
        )}
      >
        {comments.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No messages yet. Say hi or ask a question.
          </p>
        ) : (
          <div className="space-y-4">
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
        )}
      </div>

      {/* Composer pinned below the scroll area */}
      <div className="flex items-end gap-2 border-t bg-background px-3 py-3">
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
