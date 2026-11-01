"use client";

/**
 * The editor (specs/product/essays/workspace.md "The editor"): one plain `<textarea>` with the site's styles, 18 px on
 * phones (never under 16, so iOS doesn't zoom), auto-growing, no toolbar; the sticky count bar; autosave to this
 * browser at once and to the server one second after typing stops; the conflict prompt when the server copy is newer
 * ("You edited this on another device; keep which?"); the version list with restore; the comment thread; status.
 * A guardian gets the same page with the field read-only and the comment box live.
 *
 * Suggestions (specs/product/essays/editors.md "1. Suggestions"): a guardian gets Suggest changes (SuggestBox.tsx) under
 * the field; the student, while a suggestion or a reader's fix is open, the banner and two tabs, Write and Review
 * changes (ReviewChanges.tsx). A decision saves what is waiting first, then the server's new text and `updated` swap
 * in without the conflict prompt. The open changes are underlined in the field in their author's color.
 *
 * The local copy (`localStorage`, key `quad.essay.<id>`) is a per-device safety net: what was typed, and the server
 * copy's `updated` it was typed over. It is cleared once the server has the text.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/analytics";
import { countText, type CountKind, type EssayLimit } from "@/lib/essays/count";
import { anchorFor } from "@/lib/essays/normalize";
import { acceptFix, decideSuggestion, deleteEssay, renameEssay, restoreVersion, saveEssay, setEssayStatus } from "@/lib/essays/store";
import { locateChange, type Decision } from "@/lib/essays/suggestions";
import { spanOffsets } from "@/lib/essays/notes-view";
import {
  bannerLine,
  changeMarks,
  editorLabel,
  openSuggestions,
  reviewCount,
  reviewEditors,
  showsReviewTabs,
  type ReviewEditor,
  type SuggestionChanges,
  type SuggestionView,
  type ReaderFix,
} from "@/lib/essays/review-view";
import { ESSAY_STATUSES, essaysHref, STATUS_LABEL, type CommentAnchor, type EssayStatus, type VersionRow } from "@/lib/essays/rows";
import { nameWarning, otherCollegesNamed } from "@/lib/essays/variants";
import { CountBar } from "./CountBar";
import { Marks, MarksLegend } from "./Marks";
import { useColors, useMarkOpener, usePublishMarks, usePublishMarksText } from "./marks-context";
import { useReaderFixes } from "./fixes-context";
import { DRAFT_CHANGED, ReviewChanges, type DecideResult } from "./ReviewChanges";
import { SuggestBox } from "./SuggestBox";
import { Comments, type CommentView } from "./Comments";
import { VersionList } from "./VersionList";
import { cn } from "@/lib/utils";

const SAVE_AFTER_MS = 1000;
const NO_SUGGESTIONS: SuggestionView[] = [];
const NO_FIXES: readonly ReaderFix[] = [];
const localKey = (id: string) => `quad.essay.${id}`;

type Local = { body: string; base: string; at: number };

function readLocal(id: string): Local | null {
  try {
    const raw = window.localStorage.getItem(localKey(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Local>;
    return typeof v.body === "string" && typeof v.base === "string" ? { body: v.body, base: v.base, at: Number(v.at) || 0 } : null;
  } catch {
    return null;
  }
}
function writeLocal(id: string, v: Local | null) {
  try {
    if (v) window.localStorage.setItem(localKey(id), JSON.stringify(v));
    else window.localStorage.removeItem(localKey(id));
  } catch {
    // Private mode or storage full: the server save still runs.
  }
}

type SaveState = "saved" | "saving" | "local" | "error";
const SAVE_LINE: Record<SaveState, string> = { saved: "Saved", saving: "Saving…", local: "Saved on this device", error: "Not saved yet" };

export interface EditorEssay {
  id: string;
  title: string;
  body: string;
  updated: string;
  status: EssayStatus;
  countKind: CountKind;
  limit: EssayLimit | null;
}

export function Editor({
  essay,
  canWrite,
  userId,
  person,
  versions,
  comments,
  forCollege,
  planColleges,
  label,
  suggestions = NO_SUGGESTIONS,
  studentFirst = null,
}: {
  essay: EditorEssay;
  canWrite: boolean;
  userId: string;
  person: string | null;
  versions: VersionRow[];
  comments: CommentView[];
  forCollege: { unit_id: string; name: string } | null;
  planColleges: { unit_id: string; name: string }[];
  /** The field's accessible label (the prompt's title). */
  label: string;
  /** The draft's suggestions, withdrawn ones left out, newest first (lib/essays/load.ts readEssay). */
  suggestions?: SuggestionView[];
  /** The student's first name ("Waiting for Alice"). */
  studentFirst?: string | null;
}) {
  const router = useRouter();
  const [text, setTextState] = useState(essay.body);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<{ body: string; updated: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<EssayStatus>(essay.status);
  const [pending, start] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the timers and the save callbacks read: the field's text and the server copy's `updated` it was typed over.
  const latest = useRef({ text: essay.body, serverUpdated: essay.updated });
  const setText = useCallback((v: string) => {
    latest.current.text = v;
    setTextState(v);
  }, []);
  const setServerUpdated = useCallback((v: string) => {
    latest.current.serverUpdated = v;
  }, []);

  // Auto-grow: the field is as tall as its text (no inner scroll), at least a phone screen's worth.
  const grow = useCallback(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 320)}px`;
  }, []);
  const [tab, setTab] = useState<"write" | "review">("write");
  useEffect(grow, [text, tab, grow]);
  // The marks in the draft (Marks.tsx) draw under the field's live text.
  usePublishMarksText(text);

  const save = useCallback(
    async (body: string, opts: { force?: boolean; mark?: string } = {}) => {
      setSaveState("saving");
      const r = await saveEssay(essay.id, body, { expectedUpdated: latest.current.serverUpdated, force: opts.force, mark: opts.mark ?? null });
      if (r.ok) {
        setServerUpdated(r.updated);
        if (latest.current.text === body) writeLocal(essay.id, null);
        setSaveState(latest.current.text === body ? "saved" : "local");
        if (r.versioned) {
          track("essay_saved_version", { source: "typed" });
          if (opts.mark) router.refresh();
        }
        return;
      }
      if ("conflict" in r) {
        setConflict(r.conflict);
        setSaveState("local");
        return;
      }
      setSaveState("error");
      setMessage(r.message);
    },
    [essay.id, router, setServerUpdated],
  );

  // On open: a local copy this device didn't get to the server. Typed over the server copy it knew: send it now.
  // Typed over an older one (another device saved since): ask which to keep.
  useEffect(() => {
    if (!canWrite) return;
    const local = readLocal(essay.id);
    if (!local || local.body === essay.body) {
      writeLocal(essay.id, null);
      return;
    }
    // After hydration (the server rendered the server copy; the local one exists only here).
    void Promise.resolve().then(() => {
      setText(local.body);
      if (Date.parse(essay.updated) <= Date.parse(local.base)) {
        void save(local.body);
      } else {
        setConflict({ body: essay.body, updated: essay.updated });
        setSaveState("local");
      }
    });
    // Only on the first open of this draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [essay.id]);

  // Leaving the page: send what is waiting.
  useEffect(() => {
    const flush = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void save(latest.current.text);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save]);

  const onChange = (value: string) => {
    setText(value);
    setMessage(null);
    writeLocal(essay.id, { body: value, base: latest.current.serverUpdated, at: Date.now() });
    setSaveState("local");
    if (conflict) return; // nothing goes to the server until the student picks
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(value);
    }, SAVE_AFTER_MS);
  };

  const keepMine = () => {
    const mine = latest.current.text;
    setConflict(null);
    void save(mine, { force: true });
  };
  const keepTheirs = () => {
    if (!conflict) return;
    setText(conflict.body);
    setServerUpdated(conflict.updated);
    writeLocal(essay.id, null);
    setConflict(null);
    setSaveState("saved");
  };

  // What is waiting goes to the server first, so a restore or a decision starts from the text on screen.
  const flush = async () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    await save(latest.current.text);
  };
  // The server's new text after a restore or a decision: in the field, no conflict prompt.
  const swapIn = (body: string, updated: string) => {
    setText(body);
    setServerUpdated(updated);
    writeLocal(essay.id, null);
    setSaveState("saved");
  };

  const restore = (versionId: string) =>
    start(async () => {
      await flush();
      const r = await restoreVersion(essay.id, versionId);
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      swapIn(r.body, r.updated);
      track("essay_saved_version", { source: "restored" });
      router.refresh();
    });

  const mark = () =>
    start(async () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      await save(latest.current.text, { mark: "Marked" });
    });

  const changeStatus = (next: EssayStatus) =>
    start(async () => {
      const r = await setEssayStatus(essay.id, next);
      if (r.ok) setStatus(next);
      else setMessage(r.message);
    });

  const getAnchor = (): CommentAnchor | null => {
    const el = field.current;
    return el ? anchorFor(el.value, el.selectionStart, el.selectionEnd) : null;
  };

  /* Suggestions (specs/product/essays/editors.md "1. Suggestions"). The student reviews every open one and the
     reader's fixes; an editor sees their own. Each suggestion's changes are computed once from its base (never per
     keystroke); where they sit in the live text is found when drawn. */
  const [localDecisions, setLocalDecisions] = useState<Record<string, Record<string, Decision>>>({});
  const [focus, setFocus] = useState<{ editorId: string; key: string; n: number } | null>(null);
  const { fixes, setNoteState } = useReaderFixes();
  const colors = useColors();
  const open = useMemo<SuggestionChanges[]>(() => (canWrite ? openSuggestions(suggestions, localDecisions) : []), [canWrite, suggestions, localDecisions]);
  const reviewFixes = canWrite ? fixes : NO_FIXES;
  const reviewing = showsReviewTabs(open, reviewFixes);
  const shownTab = reviewing ? tab : "write";
  const mine = useMemo(() => (canWrite ? null : (suggestions.find((s) => s.status === "open" && s.author_id === userId) ?? null)), [canWrite, suggestions, userId]);
  const mineOpen = useMemo(() => (mine ? openSuggestions([mine]) : []), [mine]);
  // The open changes, underlined in the field in their author's color (an editor sees their own).
  const changeItems = useMemo(() => (canWrite ? open.flatMap((x) => changeMarks(x, editorLabel(x.suggestion))) : mineOpen.flatMap((x) => changeMarks(x, "You"))), [canWrite, open, mineOpen]);
  usePublishMarks("changes", changeItems);
  const editors = useMemo<ReviewEditor[]>(() => (shownTab === "review" ? reviewEditors(text, open, reviewFixes, locateChange) : []), [shownTab, text, open, reviewFixes]);

  // Open on a change's mark: to Review changes, that editor, that change.
  useMarkOpener(
    "change",
    canWrite
      ? (item) => {
          const key = item.change?.key;
          const x = key ? open.find((o) => o.changes.some((c) => c.key === key)) : undefined;
          if (!key || !x) return false;
          setTab("review");
          setFocus((f) => ({ editorId: x.suggestion.id, key, n: (f?.n ?? 0) + 1 }));
          return true;
        }
      : null,
  );
  const review = (editorId: string | null) => {
    setTab("review");
    if (editorId) setFocus((f) => ({ editorId, key: "", n: (f?.n ?? 0) + 1 }));
  };

  const decideFixes = async (decisions: Record<string, Decision>): Promise<DecideResult> => {
    // From the end of the text to the start, so an earlier fix's offsets in the same paragraph still hold.
    const at = (id: string) => {
      const f = fixes.find((x) => x.noteId === id);
      return f ? (spanOffsets(latest.current.text, f.span)?.start ?? -1) : -1;
    };
    const ids = Object.keys(decisions).sort((a, b) => at(b) - at(a));
    const stale: string[] = [];
    let accepted = false;
    for (const id of ids) {
      if (decisions[id] === "accepted") {
        const r = await acceptFix(id);
        if (!r.ok) {
          if (r.message.startsWith(DRAFT_CHANGED)) {
            stale.push(id);
            continue;
          }
          return { message: r.message };
        }
        swapIn(r.body, r.updated);
        setNoteState(id, "done");
        accepted = true;
      } else {
        // Ignored through the notes' own route, as the notes list's Ignore does.
        const r = await fetch("/api/essays/review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noteId: id, state: "ignored" }) });
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          return { message: body.error ?? "That didn't work. Try again in a moment." };
        }
        setNoteState(id, "ignored");
      }
    }
    if (accepted) router.refresh();
    return { stale };
  };

  const decide = async (editor: ReviewEditor, decisions: Record<string, Decision>): Promise<DecideResult> => {
    await flush();
    if (editor.kind === "reader") return decideFixes(decisions);
    const r = await decideSuggestion(editor.id, decisions);
    if (!r.ok) return { message: r.message };
    if (r.body !== latest.current.text) swapIn(r.body, r.updated);
    else setServerUpdated(r.updated);
    const applied = new Set(r.applied);
    setLocalDecisions((l) => {
      const mineNow = { ...(l[editor.id] ?? {}) };
      for (const [k, d] of Object.entries(decisions)) if (d === "rejected" || applied.has(k)) mineNow[k] = d;
      return { ...l, [editor.id]: mineNow };
    });
    // The version list gains its line (and the suggestion leaves the open list) from the server.
    if (r.applied.length > 0 || r.status === "decided") router.refresh();
    return { stale: r.stale };
  };

  const count = countText(text, essay.countKind);
  const hits = forCollege ? otherCollegesNamed(text, forCollege, planColleges) : [];
  const warning = nameWarning(hits, forCollege);

  return (
    <div className="space-y-6">
      {warning && (
        <p className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive" role="alert">
          {warning}
        </p>
      )}
      {conflict && (
        <div className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm" role="alert">
          <p className="font-semibold">You edited this on another device. Keep which?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={keepMine} className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 font-semibold text-background">
              This device&apos;s
            </button>
            <button type="button" onClick={keepTheirs} className="inline-flex min-h-11 items-center rounded-full px-4 font-semibold ring-1 ring-border">
              The other device&apos;s
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The one you don&apos;t keep stays in the version list once you write on.</p>
        </div>
      )}

      {/* The banner: one line per editor with an open suggestion (editors.md "What the student sees"). */}
      {shownTab === "write" && open.length > 0 && (
        <div className="rounded-2xl border px-4 py-1">
          {open.map((x) => (
            <p key={x.suggestion.id} className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="font-semibold">{bannerLine(x.suggestion, x.changes.length)}</span>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => review(x.suggestion.id)} className="-ml-1 inline-flex min-h-11 items-center rounded-full px-2 font-semibold text-primary hover:underline">
                Review
              </button>
            </p>
          ))}
        </div>
      )}
      {reviewing && (
        <div role="tablist" aria-label="The draft" className="flex gap-2 border-b">
          {(["write", "review"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`essay-tab-${t}`}
              aria-selected={shownTab === t}
              aria-controls={`essay-panel-${t}`}
              onClick={() => setTab(t)}
              className={cn("-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold", shownTab === t ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t === "write" ? "Write" : "Review changes"}
              {t === "review" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{reviewCount(open, reviewFixes)}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start lg:gap-6">
        <div className="min-w-0">
          {shownTab === "review" && (
            <div role="tabpanel" id="essay-panel-review" aria-labelledby="essay-tab-review">
              <ReviewChanges text={text} editors={editors} colors={colors} canDecide={canWrite} onDecide={decide} focus={focus} />
            </div>
          )}
          {/* Write: the field stays mounted under Review changes (hidden), so its text, autosave and marks carry on. */}
          <div className={cn(shownTab === "review" && "hidden")} {...(reviewing ? { role: "tabpanel", id: "essay-panel-write", "aria-labelledby": "essay-tab-write" } : {})}>
            <label htmlFor="essay-field" className="sr-only">
              {label}
            </label>
            <MarksLegend locate={locateChange} className="mb-2" />
            {/* The field over its marks (Marks.tsx): the wrapper carries the background and border; the field is transparent. */}
            <div className={cn("relative rounded-3xl border bg-background", !canWrite && "bg-muted/30")}>
              <Marks locate={locateChange} />
              <textarea
                id="essay-field"
                ref={field}
                value={text}
                readOnly={!canWrite}
                onChange={(e) => onChange(e.target.value)}
                spellCheck
                autoCapitalize="sentences"
                placeholder={canWrite ? "Start writing" : "Nothing written yet"}
                className="relative z-10 block min-h-80 w-full resize-none overflow-hidden rounded-3xl bg-transparent px-4 py-4 text-[18px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 sm:text-lg"
              />
            </div>
          </div>
        </div>
        <div className="sticky bottom-[calc(var(--tabbar-h,0px)+0.5rem)] z-10 mt-3 lg:top-[calc(var(--header-h)+1rem)] lg:bottom-auto lg:mt-0">
          <CountBar count={count} limit={essay.limit} kind={essay.countKind} saveLine={canWrite ? SAVE_LINE[saveState] : "Read only"} />
          {canWrite && (
            <div className="mt-2 hidden flex-col gap-2 lg:flex">
              <StatusControl status={status} onChange={changeStatus} disabled={pending} />
              <button type="button" onClick={mark} disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted">
                Mark a version
              </button>
            </div>
          )}
        </div>
      </div>

      {canWrite && (
        <div className="flex flex-wrap gap-2 lg:hidden">
          <StatusControl status={status} onChange={changeStatus} disabled={pending} />
          <button type="button" onClick={mark} disabled={pending} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted">
            Mark a version
          </button>
        </div>
      )}
      {!canWrite && <p className="text-sm text-muted-foreground">{STATUS_LABEL[status]}</p>}
      {/* An editor's own copy (specs/product/essays/editors.md "How an editor suggests"); never the student's. */}
      {!canWrite && <SuggestBox essayId={essay.id} userId={userId} text={text} countKind={essay.countKind} limit={essay.limit} mine={mine} studentFirst={studentFirst} color={colors[userId] ?? "blue"} />}
      {message && (
        <p className="text-sm text-destructive" role="status">
          {message}
        </p>
      )}

      <Comments essayId={essay.id} comments={comments} text={text} userId={userId} canResolve={canWrite} getAnchor={getAnchor} />

      <section aria-labelledby="versions-title" className="space-y-3">
        <h2 id="versions-title" className="font-display text-lg font-bold">
          Versions
        </h2>
        <VersionList essayId={essay.id} versions={versions} kind={essay.countKind} canWrite={canWrite} onRestore={restore} />
      </section>

      {canWrite && <DraftSettings id={essay.id} title={essay.title} person={person} />}
    </div>
  );
}

function StatusControl({ status, onChange, disabled }: { status: EssayStatus; onChange: (s: EssayStatus) => void; disabled: boolean }) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm ring-1 ring-border">
      <span className="text-muted-foreground">Status</span>
      <select value={status} disabled={disabled} onChange={(e) => onChange(e.target.value as EssayStatus)} className="bg-transparent font-semibold outline-none">
        {ESSAY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Rename and delete, folded: rarely used, and delete never sits beside the field. */
function DraftSettings({ id, title, person }: { id: string; title: string; person: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(title);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <details className="rounded-2xl border px-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold [&::-webkit-details-marker]:hidden">Rename or delete</summary>
      <div className="space-y-3 pb-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await renameEssay(id, name);
              setMessage(r.ok ? "Renamed." : r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          <label htmlFor="essay-title" className="sr-only">
            Name
          </label>
          <input id="essay-title" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-full border bg-background px-4 text-base" />
          <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1 ring-border">
            Rename
          </button>
        </form>
        <button
          type="button"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-destructive ring-1 ring-destructive/40"
          onClick={() => {
            if (!window.confirm("Delete this draft and every version of it? This can't be undone.")) return;
            start(async () => {
              const r = await deleteEssay(id);
              if (r.ok) router.push(essaysHref({ person }));
              else setMessage(r.message);
            });
          }}
        >
          Delete this draft
        </button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </details>
  );
}

export default Editor;
