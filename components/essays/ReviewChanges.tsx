"use client";

/**
 * Review changes (specs/product/essays/editors.md "What the student sees", "The reader's fixes", "Phones and
 * accessibility"): a read-only rendering of the draft at the field's type with one editor's changes inline, deleted
 * words struck and inserted words underlined in the editor's color. A chip per editor (one at a time, so a change never
 * has two owners; the reader's mechanics fixes as "Reader's notes"); **With changes** / **As suggested** / **Original**;
 * **Accept** and **Reject** after each change on a pointer device, and under its paragraph once tapped on a phone;
 * **Accept all** / **Reject all**, each asking once; the changes whose spot the student rewrote listed under the text
 * as "The draft changed here" with the suggested words and **Copy**.
 *
 * The decisions go through the Editor (`onDecide`), which saves what is waiting, calls the server, and swaps in the
 * new text. Each change's element has `id="change-<key>"`, so **Open** on a change's mark in the field lands here.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { changeLine, type MarkColor } from "@/lib/essays/marks";
import { asSuggested, renderWithChanges, type ChangeView, type Decision, type Segment } from "@/lib/essays/suggestions";
import { applyPlaced, changesWord, confirmLine, placedOf, segmentBlocks, staleOf, type ReviewEditor } from "@/lib/essays/review-view";
import { cn } from "@/lib/utils";
import { MARK_VARS, markVar } from "./Marks";

export type ReviewView = "with" | "suggested" | "original";
export const VIEW_LABEL: Record<ReviewView, string> = {
  with: "With changes",
  suggested: "As suggested",
  original: "Original",
};
const VIEWS: readonly ReviewView[] = ["with", "suggested", "original"];

export const DRAFT_CHANGED = "The draft changed here";

export type DecideResult = { stale: string[] } | { message: string };

/** The field's type (Editor.tsx), so the rendering reads as the draft does. */
const TEXT_CLASS = "rounded-3xl border bg-background px-4 py-4 text-[18px] leading-relaxed whitespace-pre-wrap break-words sm:px-6 sm:text-lg [overflow-wrap:break-word]";
const BTN = "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted disabled:opacity-50";

/** The segments with this page's pending decisions shown as if made: an accepted change reads as its new words, a rejected one as the old. */
function withPending(segments: readonly Segment[], pending: Record<string, Decision>): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const d = s.key ? pending[s.key] : undefined;
    if (!d) out.push(s);
    else if ((d === "accepted" && s.kind === "ins") || (d === "rejected" && s.kind === "del")) out.push({ kind: "text", text: s.text });
  }
  return out;
}

/** A change's words for a screen reader: what it takes out and what it puts in. */
function changeAria(c: Pick<ChangeView, "removed" | "inserted">, label: string): string {
  const out = c.removed.trim();
  const put = c.inserted.trim();
  const what = out && put ? `replaces “${out}” with “${put}”` : put ? `adds “${put}”` : `removes “${out}”`;
  return `${label}'s change: ${what}`;
}

/**
 * The text with one editor's open changes marked inline. With `canDecide`, each change is a target: on a pointer
 * device Accept and Reject follow it; a tap selects it and the two appear under its paragraph. Without (an editor's
 * own preview, "Waiting for Alice"), the changes are marked and nothing more.
 */
export function ChangedText({
  text,
  changes,
  color,
  label,
  canDecide,
  selected = null,
  pending = {},
  busy = false,
  onSelect,
  onDecide,
  className,
}: {
  text: string;
  changes: readonly ChangeView[];
  color: MarkColor;
  label: string;
  canDecide: boolean;
  selected?: string | null;
  pending?: Record<string, Decision>;
  busy?: boolean;
  onSelect?: (key: string | null) => void;
  onDecide?: (key: string, d: Decision) => void;
  className?: string;
}) {
  const blocks = useMemo(() => segmentBlocks(withPending(renderWithChanges(text, changes), pending)), [text, changes, pending]);
  const byKey = useMemo(() => new Map(changes.map((c) => [c.key, c])), [changes]);
  const tint = { color: markVar(color), textDecorationColor: markVar(color) };

  const actions = (key: string, where: "inline" | "under") => (
    <span className={cn("gap-1.5 align-middle", where === "inline" ? "mx-1 hidden pointer-fine:inline-flex" : "flex flex-wrap pointer-fine:hidden")}>
      <button type="button" disabled={busy} onClick={() => onDecide?.(key, "accepted")} className={cn(BTN, "bg-foreground font-semibold text-background ring-0 hover:bg-foreground/90")}>
        Accept
      </button>
      <button type="button" disabled={busy} onClick={() => onDecide?.(key, "rejected")} className={BTN}>
        Reject
      </button>
    </span>
  );

  return (
    <div className={cn(MARK_VARS, TEXT_CLASS, className)}>
      {blocks.map((block, bi) => {
        // Consecutive segments of one change (its struck words, then its new ones) render as one target.
        const runs: { key?: string; segs: Segment[] }[] = [];
        for (const seg of block) {
          const last = runs[runs.length - 1];
          if (seg.key && last?.key === seg.key) last.segs.push(seg);
          else runs.push({ key: seg.key, segs: [seg] });
        }
        const chosen = canDecide && selected && runs.some((r) => r.key === selected) ? selected : null;
        return (
          <div key={bi}>
            <div>
              {/* An empty line keeps its height. */}
              {runs.length === 0 && "​"}
              {runs.map((run, ri) => {
                if (!run.key) return <span key={ri}>{run.segs.map((s) => s.text).join("")}</span>;
                const key = run.key;
                const change = byKey.get(key);
                const inner = run.segs.map((s, si) =>
                  s.kind === "del" ? (
                    <del key={si} className="line-through decoration-2" style={tint}>
                      {s.text}
                    </del>
                  ) : s.kind === "ins" ? (
                    <ins key={si} className="underline decoration-2 underline-offset-4" style={tint}>
                      {s.text}
                    </ins>
                  ) : (
                    <span key={si}>{s.text}</span>
                  ),
                );
                if (!canDecide) {
                  return (
                    <span key={ri} id={`change-${key}`} data-change={key}>
                      {inner}
                    </span>
                  );
                }
                const onKey = (e: KeyboardEvent<HTMLSpanElement>) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  onSelect?.(selected === key ? null : key);
                };
                return (
                  <span key={ri}>
                    <span
                      id={`change-${key}`}
                      data-change={key}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected === key}
                      aria-label={change ? changeAria(change, label) : undefined}
                      onClick={() => onSelect?.(selected === key ? null : key)}
                      onKeyDown={onKey}
                      className={cn("cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === key && "bg-muted")}
                    >
                      {inner}
                    </span>
                    {actions(key, "inline")}
                  </span>
                );
              })}
            </div>
            {chosen && <div className="mt-2 mb-1 font-sans text-sm">{actions(chosen, "under")}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** The changes whose spot the student rewrote: the suggested words, Copy, and (for the student) Reject. */
export function StaleChanges({ changes, canDecide, busy = false, onReject }: { changes: readonly ChangeView[]; canDecide: boolean; busy?: boolean; onReject?: (key: string) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (changes.length === 0) return null;
  const copy = async (c: ChangeView) => {
    try {
      await navigator.clipboard.writeText(c.inserted.trim());
      setCopied(c.key);
    } catch {
      setCopied(null);
    }
  };
  return (
    <ul className="space-y-2">
      {changes.map((c) => (
        <li key={c.key} id={`change-${c.key}`} className="rounded-2xl border p-4 text-sm">
          <p className="font-semibold">{DRAFT_CHANGED}</p>
          <p className="mt-1 break-words text-muted-foreground">{changeLine(c)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {c.inserted.trim() && (
              <button type="button" onClick={() => void copy(c)} className={BTN}>
                {copied === c.key ? "Copied" : "Copy"}
              </button>
            )}
            {canDecide && (
              <button type="button" disabled={busy} onClick={() => onReject?.(c.key)} className={BTN}>
                Reject
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReviewChanges({
  text,
  editors,
  colors,
  canDecide,
  onDecide,
  focus = null,
  initialView = "with",
  initialEditor,
}: {
  text: string;
  editors: readonly ReviewEditor[];
  colors: Record<string, MarkColor>;
  /** Only the student decides. */
  canDecide: boolean;
  onDecide: (editor: ReviewEditor, decisions: Record<string, Decision>) => Promise<DecideResult>;
  /** Open on a change's mark: show its editor, with changes, the change selected and in view (an empty key: the editor only, from the banner). */
  focus?: { editorId: string; key: string; n: number } | null;
  initialView?: ReviewView;
  initialEditor?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(focus?.editorId ?? initialEditor ?? null);
  const [view, setView] = useState<ReviewView>(focus ? "with" : initialView);
  const [selected, setSelected] = useState<string | null>(focus?.key || null);
  const [pending, setPending] = useState<Record<string, Decision>>({});
  const [confirm, setConfirm] = useState<"accept" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Open on a mark (or the banner's Review) while already here: switch to its editor and change, as it renders.
  const [seenFocus, setSeenFocus] = useState(focus);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    if (focus) {
      setActiveId(focus.editorId);
      setView("with");
      setSelected(focus.key || null);
      setConfirm(null);
    }
  }
  // Then bring the change into view once drawn.
  useEffect(() => {
    if (!focus?.key) return;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(`change-${focus.key}`);
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  const active = editors.find((e) => e.id === activeId) ?? editors[0] ?? null;

  if (!active) return <p className="text-sm text-muted-foreground">Every change is decided.</p>;

  const color = colors[active.authorKey] ?? "gray";
  const open = active.changes.filter((c) => c.decision === null && !pending[c.key]);
  const placed = placedOf(open);
  const stale = staleOf(open);
  const shown = view === "with" ? active.changes : [];

  const decide = async (decisions: Record<string, Decision>) => {
    setBusy(true);
    setMessage(null);
    setConfirm(null);
    setPending((p) => ({ ...p, ...decisions }));
    try {
      const r = await onDecide(active, decisions);
      if ("message" in r) setMessage(r.message);
      else if (r.stale.length > 0)
        setMessage(`${DRAFT_CHANGED}: ${r.stale.length === 1 ? "one change no longer fits" : `${r.stale.length} changes no longer fit`}, so ${r.stale.length === 1 ? "it is" : "they are"} listed below the text.`);
      setSelected(null);
    } finally {
      setPending((p) => {
        const next = { ...p };
        for (const k of Object.keys(decisions)) delete next[k];
        return next;
      });
      setBusy(false);
    }
  };
  const all = (d: Decision) => decide(Object.fromEntries((d === "accepted" ? placed : open).map((c) => [c.key, d])));
  const confirmCount = confirm === "accept" ? placed.length : open.length;

  return (
    <div className="space-y-4">
      {editors.length > 1 && (
        <div role="group" aria-label="Whose changes" className={cn(MARK_VARS, "-mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0")}>
          {editors.map((e) => {
            const left = e.changes.filter((c) => c.decision === null).length;
            return (
              <button
                key={e.id}
                type="button"
                aria-pressed={e.id === active.id}
                onClick={() => {
                  setActiveId(e.id);
                  setSelected(null);
                  setConfirm(null);
                  setMessage(null);
                }}
                className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted", e.id === active.id && "bg-muted ring-2 ring-foreground/40")}
              >
                <span className="inline-block size-3 rounded-full" style={{ background: markVar(colors[e.authorKey] ?? "gray") }} aria-hidden />
                {e.label}
                <span className="text-xs font-normal text-muted-foreground">{left}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className={cn(MARK_VARS, "space-y-1")}>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="inline-block size-3 rounded-full" style={{ background: markVar(color) }} aria-hidden />
          {active.label}: {changesWord(open.length)}
        </p>
        {active.note && <p className="text-sm break-words text-muted-foreground">“{active.note}”</p>}
      </div>

      <div role="group" aria-label="Show the draft" className="inline-flex rounded-full p-1 ring-1 ring-border">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn("inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold", view === v ? "bg-foreground text-background" : "hover:bg-muted")}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      {view === "with" ? (
        <ChangedText
          text={text}
          changes={shown}
          color={color}
          label={active.label}
          canDecide={canDecide}
          selected={selected}
          pending={pending}
          busy={busy}
          onSelect={setSelected}
          onDecide={(key, d) => void decide({ [key]: d })}
        />
      ) : (
        <div className={TEXT_CLASS} data-view={view}>
          {view === "suggested" ? (active.kind === "reader" ? applyPlaced(text, active.changes) : asSuggested(text, active.changes)) : text}
        </div>
      )}

      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}

      <StaleChanges changes={stale} canDecide={canDecide} busy={busy} onReject={(key) => void decide({ [key]: "rejected" })} />

      {canDecide && open.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          {confirm ? (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <p className="text-sm font-semibold">{confirmLine(confirm, active.label, confirmCount)}</p>
              <button type="button" disabled={busy} onClick={() => void all(confirm === "accept" ? "accepted" : "rejected")} className={cn(BTN, "bg-foreground text-background ring-0 hover:bg-foreground/90")}>
                {confirm === "accept" ? "Accept all" : "Reject all"}
              </button>
              <button type="button" onClick={() => setConfirm(null)} className={BTN}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {placed.length > 0 && (
                <button type="button" disabled={busy} onClick={() => setConfirm("accept")} className={BTN}>
                  Accept all
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => setConfirm("reject")} className={BTN}>
                Reject all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReviewChanges;
