"use client";

/**
 * A reader's notes (specs/product/essays/reviewer.md "When it runs", "Honesty"): the "Read this draft" button (the
 * student's, never automatic), the notes of the newest read with the one-line disclaimer, each note opening to its spot
 * in the field, done / ignored for the student, and the earlier reads folded below. A guardian sees the same notes,
 * read-only. Notes list under the field on a phone; on a wide screen each open note also gets a numbered mark in the
 * margin beside its line of the field (measured against the field, `#essay-field`, so the editor stays untouched).
 * `mechanics` first, then the rest in draft order (the server stores them in that order).
 *
 * The data comes from /api/essays/review (GET for the reads, POST for a new one, PATCH for a note's state).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
// Types only from the server module (erased): the reader's code and rubric never reach this bundle.
import type { StoredNote, StoredReview } from "@/lib/essays/review";
import { CATEGORY_LABEL, spanOffsets } from "@/lib/essays/notes-view";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

const FIELD_ID = "essay-field";
const DISCLAIMER = "Questions and things a careful reader noticed. Nothing here is a grade, and the words stay yours.";
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const NO_REVIEWS: StoredReview[] = [];
const NO_NOTES: StoredNote[] = [];

type Load ={ kind: "loading" } | { kind: "ready"; reviews: StoredReview[] } | { kind: "error"; message: string };

function field(): HTMLTextAreaElement | null {
  const el = typeof document !== "undefined" ? document.getElementById(FIELD_ID) : null;
  return el instanceof HTMLTextAreaElement ? el : null;
}

/** The y offset (from the field's top) of the character at `index`, measured with a hidden copy of the field. */
function offsetTop(el: HTMLTextAreaElement, index: number): number {
  const cs = window.getComputedStyle(el);
  const div = document.createElement("div");
  const copy = ["boxSizing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "textIndent"] as const;
  for (const p of copy) div.style[p] = cs[p];
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.overflowWrap = "break-word";
  div.style.top = "0";
  div.style.left = "-9999px";
  div.style.width = `${el.offsetWidth}px`;
  div.textContent = el.value.slice(0, index);
  const mark = document.createElement("span");
  mark.textContent = el.value.slice(index, index + 1) || ".";
  div.appendChild(mark);
  document.body.appendChild(div);
  const top = mark.offsetTop;
  div.remove();
  return top;
}

/** Selects a note's words in the field and scrolls them into view; false when the draft changed under the span. */
function openSpan(note: StoredNote): boolean {
  const el = field();
  if (!el || !note.span) return false;
  const at = spanOffsets(el.value, note.span);
  if (!at) return false;
  const y = el.getBoundingClientRect().top + window.scrollY + offsetTop(el, at.start);
  window.scrollTo({ top: Math.max(0, y - 140), behavior: "smooth" });
  el.focus({ preventScroll: true });
  el.setSelectionRange(at.start, at.end);
  return true;
}

export function Notes({ essayId, canRequest }: { essayId: string; canRequest: boolean }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/essays/review?essayId=${encodeURIComponent(essayId)}`, { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { reviews?: StoredReview[]; error?: string };
        if (!live) return;
        setLoad(r.ok ? { kind: "ready", reviews: body.reviews ?? [] } : { kind: "error", message: body.error ?? "The notes didn't load." });
      })
      .catch(() => live && setLoad({ kind: "error", message: "The notes didn't load." }));
    return () => {
      live = false;
    };
  }, [essayId]);

  const read = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch("/api/essays/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ essayId }) });
      const body = (await r.json().catch(() => ({}))) as { review?: StoredReview; message?: string | null; error?: string };
      if (!r.ok || !body.review) {
        setMessage(body.error ?? "That didn't work. Try again in a moment.");
        return;
      }
      const review = body.review;
      setLoad((l) => ({ kind: "ready", reviews: [review, ...(l.kind === "ready" ? l.reviews : [])] }));
      setMessage(body.message ?? null);
      router.refresh();
    } catch {
      setMessage("That didn't work. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const mark = async (note: StoredNote, state: StoredNote["state"]) => {
    const r = await fetch("/api/essays/review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noteId: note.id, state }) });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setMessage(body.error ?? "That didn't work. Try again in a moment.");
      return;
    }
    setLoad((l) => (l.kind === "ready" ? { kind: "ready", reviews: l.reviews.map((rv) => ({ ...rv, notes: rv.notes.map((n) => (n.id === note.id ? { ...n, state } : n)) })) } : l));
  };

  const show = (note: StoredNote) => setMoved(openSpan(note) ? null : note.id);

  const reviews = load.kind === "ready" ? load.reviews : NO_REVIEWS;
  const [latest, ...earlier] = reviews;

  return (
    <section aria-labelledby="notes-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="notes-title" className="inline-flex items-center gap-1.5 font-display text-lg font-bold">
          A reader&apos;s notes
          <InfoTip term="reader-notes" />
        </h2>
        {canRequest && (
          <button type="button" onClick={read} disabled={busy} className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60">
            {busy ? "Reading…" : "Read this draft"}
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{DISCLAIMER}</p>
      {busy && (
        <p className="text-sm text-muted-foreground" role="status">
          Reading the draft. This can take up to a minute.
        </p>
      )}
      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}
      {load.kind === "error" && <p className="text-sm text-muted-foreground">{load.message}</p>}
      {load.kind === "ready" && !latest && !busy && <p className="text-sm text-muted-foreground">{canRequest ? "No notes yet." : "No notes yet. The student asks for them."}</p>}

      {latest && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Read {when(latest.created)}</p>
          {latest.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to note this time.</p>
          ) : (
            <NoteList notes={latest.notes} canMark={canRequest} onMark={mark} onShow={show} moved={moved} />
          )}
        </div>
      )}

      {earlier.length > 0 && (
        <details className="rounded-2xl border px-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold [&::-webkit-details-marker]:hidden">Earlier reads ({earlier.length})</summary>
          <div className="space-y-4 pb-4">
            {earlier.map((r) => (
              <div key={r.id} className="space-y-2">
                <p className="text-xs text-muted-foreground">Read {when(r.created)}</p>
                {r.notes.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to note this time.</p> : <NoteList notes={r.notes} canMark={false} onMark={mark} onShow={show} moved={moved} />}
              </div>
            ))}
          </div>
        </details>
      )}

      <MarginMarks notes={latest?.notes ?? NO_NOTES} onShow={show} />
    </section>
  );
}

function NoteList({ notes, canMark, onMark, onShow, moved }: { notes: StoredNote[]; canMark: boolean; onMark: (n: StoredNote, s: StoredNote["state"]) => void; onShow: (n: StoredNote) => void; moved: string | null }) {
  return (
    <ol className="space-y-2">
      {notes.map((n, i) => {
        const closed = n.state !== "open";
        return (
          <li key={n.id} id={`note-${n.id}`} className={cn("rounded-2xl border p-4 text-sm", closed && "opacity-60")}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-bold" aria-hidden>
                {i + 1}
              </span>
              <span className="font-semibold">{CATEGORY_LABEL[n.category]}</span>
              {n.span ? <span className="text-xs text-muted-foreground">Paragraph {n.span.paragraph + 1}</span> : <span className="text-xs text-muted-foreground">The whole draft</span>}
              {closed && <span className="text-xs text-muted-foreground">{n.state === "done" ? "Done" : "Ignored"}</span>}
            </div>
            {!closed && (
              <div className="mt-2 space-y-1.5">
                <p>
                  {n.observation}
                  {n.fix && <span className="ml-1 font-semibold">→ {n.fix}</span>}
                </p>
                <p className="text-muted-foreground">
                  {n.why}
                  {n.source && (
                    <>
                      {" "}
                      <a href={n.source} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                        Source
                      </a>
                    </>
                  )}
                </p>
                <p className="font-semibold">{n.ask}</p>
                {moved === n.id && <p className="text-xs text-muted-foreground">The draft has changed at this spot since it was read.</p>}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {n.span && !closed && (
                <button type="button" onClick={() => onShow(n)} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted">
                  Show in the draft
                </button>
              )}
              {canMark && !closed && (
                <>
                  <button type="button" onClick={() => onMark(n, "done")} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted">
                    Done
                  </button>
                  <button type="button" onClick={() => onMark(n, "ignored")} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-muted">
                    Ignore
                  </button>
                </>
              )}
              {canMark && closed && (
                <button type="button" onClick={() => onMark(n, "open")} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-muted">
                  Reopen
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * On a wide screen, a numbered mark in the margin to the left of the field beside each open note's line; tapping one
 * opens the note's spot and scrolls its card into view. Nothing on a phone (no margin there) or when the field sits
 * against the window's edge.
 */
function MarginMarks({ notes, onShow }: { notes: StoredNote[]; onShow: (n: StoredNote) => void }) {
  const [marks, setMarks] = useState<{ note: StoredNote; n: number; top: number; left: number }[]>([]);
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = field();
    if (!el || !window.matchMedia("(min-width: 1024px)").matches) return setMarks([]);
    const rect = el.getBoundingClientRect();
    if (rect.left < 48) return setMarks([]);
    const left = rect.left + window.scrollX - 40;
    const out: { note: StoredNote; n: number; top: number; left: number }[] = [];
    notes.forEach((note, i) => {
      if (!note.span || note.state !== "open") return;
      const at = spanOffsets(el.value, note.span);
      if (!at) return;
      out.push({ note, n: i + 1, top: rect.top + window.scrollY + offsetTop(el, at.start), left });
    });
    setMarks(out);
  }, [notes]);

  useEffect(() => {
    const later = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    later();
    window.addEventListener("resize", later);
    const el = field();
    el?.addEventListener("input", later);
    const observer = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(later) : null;
    if (observer && el) observer.observe(el);
    return () => {
      window.removeEventListener("resize", later);
      el?.removeEventListener("input", later);
      observer?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [measure]);

  if (marks.length === 0 || typeof document === "undefined") return null;
  // The numbers match the list's (each note's position among the newest read's notes).
  return createPortal(
    <div aria-hidden className="pointer-events-none absolute top-0 left-0">
      {marks.map((m) => (
        <button
          key={m.note.id}
          type="button"
          tabIndex={-1}
          title={CATEGORY_LABEL[m.note.category]}
          onClick={() => {
            onShow(m.note);
            document.getElementById(`note-${m.note.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }}
          className="pointer-events-auto absolute inline-flex size-7 items-center justify-center rounded-full bg-amber-500/90 text-xs font-bold text-white shadow"
          style={{ top: m.top, left: m.left }}
        >
          {m.n}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default Notes;
