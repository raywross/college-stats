"use client";

/**
 * The comment thread (specs/product/essays/workspace.md "The model": a parent or counselor "leaves comments anchored to
 * a paragraph or a span, which the student resolves"). The box is live for the student and a guardian alike; a
 * comment on a selection quotes the words it points at. Only the student resolves; the author removes their own.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/analytics";
import { addComment, deleteComment, resolveComment } from "@/lib/essays/store";
import { anchoredText } from "@/lib/essays/normalize";
import { commentAuthorKey, firstLineOf, type MarkItem } from "@/lib/essays/marks";
import type { CommentAnchor, CommentRow } from "@/lib/essays/rows";
import { cn } from "@/lib/utils";
import { usePublishMarks } from "./marks-context";

export type CommentView = CommentRow & { author_name: string | null };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const ROLE: Record<CommentRow["author_role"], string> = { student: "Student", guardian: "Parent", counselor: "Counselor" };

/**
 * The open anchored comments as marks: the student's own under "student" (gray for everyone), anyone else's under
 * their id; labelled "You" for the viewer's own, else the author's first name, else the role word.
 */
export function commentMarks(comments: readonly CommentView[], userId: string): MarkItem[] {
  return comments
    .filter((c) => !c.resolved_at && c.anchor)
    .map((c) => ({
      id: `comment-${c.id}`,
      kind: "comment" as const,
      authorKey: commentAuthorKey(c),
      label: c.author_id === userId ? "You" : (c.author_name?.trim().split(/\s+/)[0] ?? ROLE[c.author_role]) || ROLE[c.author_role],
      firstLine: firstLineOf(c.body),
      targetId: `comment-${c.id}`,
      span: c.anchor!,
    }));
}

export function Comments({
  essayId,
  comments,
  text,
  userId,
  canResolve,
  getAnchor,
}: {
  essayId: string;
  comments: CommentView[];
  /** The draft's current text, to quote what an anchored comment points at. */
  text: string;
  userId: string;
  canResolve: boolean;
  /** The field's current selection as an anchor, or null. */
  getAnchor: () => CommentAnchor | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [anchor, setAnchor] = useState<CommentAnchor | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [pending, start] = useTransition();

  const open = comments.filter((c) => !c.resolved_at);
  const resolved = comments.filter((c) => c.resolved_at);
  const shown = showResolved ? comments : open;

  // Open comments on words are marked in the draft (Marks.tsx).
  const marks = useMemo(() => commentMarks(comments, userId), [comments, userId]);
  usePublishMarks("comments", marks);

  const send = () =>
    start(async () => {
      setMessage(null);
      const r = await addComment(essayId, body, { anchor });
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      track("essay_commented", { role: r.role });
      setBody("");
      setAnchor(null);
      router.refresh();
    });

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setMessage(r.message ?? null);
      else router.refresh();
    });

  return (
    <section aria-labelledby="comments-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="comments-title" className="font-display text-lg font-bold">
          Comments{open.length > 0 ? ` (${open.length})` : ""}
        </h2>
        {resolved.length > 0 && (
          <button type="button" className="min-h-11 text-sm font-semibold text-primary" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
          </button>
        )}
      </div>

      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((c) => {
            const quoted = c.anchor ? anchoredText(text, c.anchor) : null;
            return (
              <li key={c.id} id={`comment-${c.id}`} className={cn("rounded-2xl border p-3 text-sm", c.resolved_at && "opacity-60")}>
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{c.author_name ?? ROLE[c.author_role]}</span> · {when(c.created)}
                  {c.anchor && !quoted ? " · on an earlier wording" : ""}
                </p>
                {quoted && <p className="mt-1 border-l-2 border-primary/50 pl-2 text-muted-foreground italic">“{quoted}”</p>}
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                <div className="mt-1 flex flex-wrap gap-2 empty:hidden">
                  {canResolve && (
                    <button type="button" disabled={pending} className="min-h-11 text-sm font-semibold text-primary" onClick={() => act(() => resolveComment(c.id, !c.resolved_at))}>
                      {c.resolved_at ? "Open again" : "Resolve"}
                    </button>
                  )}
                  {c.author_id === userId && (
                    <button type="button" disabled={pending} className="min-h-11 text-sm font-semibold text-muted-foreground" onClick={() => act(() => deleteComment(c.id))}>
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2">
        {anchor && (
          <p className="text-xs text-muted-foreground">
            On “{anchoredText(text, anchor) ?? "the selection"}” ·{" "}
            <button type="button" className="font-semibold text-primary" onClick={() => setAnchor(null)}>
              Comment on the whole draft
            </button>
          </p>
        )}
        <label htmlFor="comment-box" className="sr-only">
          Add a comment
        </label>
        <textarea
          id="comment-box"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Add a comment"
          className="w-full rounded-2xl border bg-background px-3 py-2 text-base"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending || body.trim() === ""} onClick={send} className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50">
            Comment
          </button>
          <button
            type="button"
            onClick={() => {
              const a = getAnchor();
              setAnchor(a);
              if (!a) setMessage("Select some words in the draft first.");
              else setMessage(null);
            }}
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted"
          >
            On the selected words
          </button>
        </div>
        {message && (
          <p className="text-sm text-destructive" role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

export default Comments;
