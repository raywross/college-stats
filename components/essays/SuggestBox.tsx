"use client";

/**
 * Suggest changes (specs/product/essays/editors.md "How an editor suggests"): for a reader of the draft who isn't the
 * student. **Suggest changes** opens the editor's own copy of the text in a second plain `<textarea>`, prefilled with
 * the current draft, with the count bar beside it, a note, the live line "3 changes", and a preview of them as the
 * student will see them; **Send suggestions**. With their own suggestion open: "Waiting for Alice" with the changes
 * marked, **Edit your suggestions** and **Withdraw** until the student has decided anything.
 *
 * The box's text is kept in this browser as it is typed (`quad.essay.<id>.suggest.<userId>`), so a lost connection
 * loses nothing; it is cleared once sent. Typing here never changes the draft.
 */
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { countText, type CountKind, type EssayLimit } from "@/lib/essays/count";
import type { MarkColor } from "@/lib/essays/marks";
import { normalizeText } from "@/lib/essays/normalize";
import { changesWord, suggestKey, waitingLine, type SuggestionView } from "@/lib/essays/review-view";
import { suggestChanges, updateSuggestion, withdrawSuggestion } from "@/lib/essays/store";
import { changesBetween, viewChanges } from "@/lib/essays/suggestions";
import { cn } from "@/lib/utils";
import { CountBar } from "./CountBar";
import { ChangedText } from "./ReviewChanges";

const MAX_NOTE = 2000;
const BTN = "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted disabled:opacity-50";
const PRIMARY = "inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60";

type Local = { body: string; note: string; editing: string | null };

function readLocal(key: string): Local | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Local>;
    return typeof v.body === "string"
      ? {
          body: v.body,
          note: typeof v.note === "string" ? v.note : "",
          editing: typeof v.editing === "string" ? v.editing : null,
        }
      : null;
  } catch {
    return null;
  }
}
function writeLocal(key: string, v: Local | null) {
  try {
    if (v) window.localStorage.setItem(key, JSON.stringify(v));
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode or storage full: the box still works; only the safety net is gone.
  }
}

export function SuggestBox({
  essayId,
  userId,
  text,
  countKind,
  limit,
  mine,
  studentFirst,
  color,
}: {
  essayId: string;
  userId: string;
  /** The draft as it is now (read-only for this viewer). */
  text: string;
  countKind: CountKind;
  limit: EssayLimit | null;
  /** This viewer's own open suggestion on the draft, if any. */
  mine: SuggestionView | null;
  studentFirst: string | null;
  /** This viewer's mark color on the draft. */
  color: MarkColor;
}) {
  const router = useRouter();
  const key = suggestKey(essayId, userId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The text the changes are counted from: the suggestion's own start when editing it, else the draft now.
  const editing = open && mine ? mine : null;
  const base = editing ? editing.base_body : text;
  const typed = useDeferredValue(draft);
  const count = useMemo(() => (open ? changesBetween(base, normalizeText(typed)).length : 0), [open, base, typed]);
  // The preview: the changes as the student will see them, found in the draft as it is now.
  const preview = useMemo(() => (open ? viewChanges(text, base, { proposed_body: normalizeText(typed), decisions: {} }) : []), [open, text, base, typed]);
  const mineChanges = useMemo(() => (mine && !open ? viewChanges(text, mine.base_body, mine) : []), [mine, open, text]);

  // A box typed in before and not sent (the connection dropped, the tab closed): open it again as it was.
  useEffect(() => {
    const local = readLocal(key);
    if (!local) return;
    if (local.editing && local.editing !== mine?.id) {
      writeLocal(key, null);
      return;
    }
    void Promise.resolve().then(() => {
      setDraft(local.body);
      setNote(local.note);
      setOpen(true);
    });
    // Only on the first open of this draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const begin = () => {
    setDraft(mine ? mine.proposed_body : text);
    setNote(mine?.note ?? "");
    setMessage(null);
    setOpen(true);
  };
  const keep = (body: string, n: string) => writeLocal(key, { body, note: n, editing: mine?.id ?? null });
  const cancel = () => {
    const start0 = mine ? mine.proposed_body : text;
    if (draft !== start0 && !window.confirm("Discard what you've changed here?")) return;
    writeLocal(key, null);
    setOpen(false);
    setMessage(null);
  };

  const send = () =>
    start(async () => {
      setMessage(null);
      const r = mine ? await updateSuggestion(mine.id, draft, note.trim() || null) : await suggestChanges(essayId, draft, note.trim() || null);
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      writeLocal(key, null);
      setOpen(false);
      router.refresh();
    });

  const withdraw = () => {
    if (!mine || !window.confirm("Withdraw your suggestions? The draft stays as it is.")) return;
    start(async () => {
      const r = await withdrawSuggestion(mine.id);
      if (!r.ok) setMessage(r.message);
      else router.refresh();
    });
  };

  const decided = mine ? Object.keys(mine.decisions ?? {}).length > 0 : false;

  if (!open) {
    if (!mine) {
      return (
        <section aria-label="Suggest changes" className="space-y-2">
          <button type="button" onClick={begin} className={PRIMARY}>
            Suggest changes
          </button>
          <p className="text-sm text-muted-foreground">Your own copy to edit. Nothing changes in the draft unless {studentFirst?.trim().split(/\s+/)[0] || "the student"} accepts it.</p>
          {message && (
            <p className="text-sm text-destructive" role="status">
              {message}
            </p>
          )}
        </section>
      );
    }
    const left = mineChanges.filter((c) => c.decision === null);
    return (
      <section aria-labelledby="suggest-title" className="space-y-3 rounded-3xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="suggest-title" className="font-display text-lg font-bold">
            {waitingLine(studentFirst)}
          </h2>
          <p className="text-sm text-muted-foreground">{changesWord(left.length)}</p>
        </div>
        {mine.note && <p className="text-sm break-words text-muted-foreground">“{mine.note}”</p>}
        <ChangedText text={text} changes={mineChanges} color={color} label="You" canDecide={false} />
        {decided ? (
          <p className="text-sm text-muted-foreground">{studentFirst?.trim().split(/\s+/)[0] || "The student"} has started deciding on these, so they can&apos;t be changed now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={begin} disabled={pending} className={BTN}>
              Edit your suggestions
            </button>
            <button type="button" onClick={withdraw} disabled={pending} className={cn(BTN, "text-muted-foreground")}>
              Withdraw
            </button>
          </div>
        )}
        {message && (
          <p className="text-sm text-destructive" role="status">
            {message}
          </p>
        )}
      </section>
    );
  }

  const words = countText(draft, countKind);
  return (
    <section aria-labelledby="suggest-title" className="space-y-4 rounded-3xl border p-4 sm:p-5">
      <h2 id="suggest-title" className="font-display text-lg font-bold">
        {mine ? "Edit your suggestions" : "Suggest changes"}
      </h2>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start lg:gap-6">
        <div className="min-w-0">
          <label htmlFor="suggest-field" className="sr-only">
            Your copy of the draft
          </label>
          <textarea
            id="suggest-field"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              keep(e.target.value, note);
            }}
            spellCheck
            autoCapitalize="sentences"
            rows={12}
            className="block min-h-80 w-full resize-y rounded-3xl border bg-background px-4 py-4 text-[18px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 sm:text-lg"
          />
        </div>
        <div className="sticky bottom-[calc(var(--tabbar-h,0px)+0.5rem)] z-10 mt-3 lg:top-[calc(var(--header-h)+1rem)] lg:bottom-auto lg:mt-0">
          <CountBar count={words} limit={limit} kind={countKind} />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="suggest-note" className="text-sm font-semibold">
          A note (optional)
        </label>
        <textarea
          id="suggest-note"
          value={note}
          maxLength={MAX_NOTE}
          rows={2}
          onChange={(e) => {
            setNote(e.target.value);
            keep(draft, e.target.value);
          }}
          className="block w-full resize-y rounded-2xl border bg-background px-4 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <p className="text-sm font-semibold" aria-live="polite">
        {changesWord(count)}
      </p>
      {count > 0 && <ChangedText text={text} changes={preview} color={color} label="You" canDecide={false} />}
      {message && (
        <p className="text-sm text-destructive" role="status">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={send} disabled={pending || count === 0} className={PRIMARY}>
          Send suggestions
        </button>
        <button type="button" onClick={cancel} disabled={pending} className={BTN}>
          Cancel
        </button>
      </div>
    </section>
  );
}

export default SuggestBox;
