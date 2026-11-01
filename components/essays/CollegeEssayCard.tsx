"use client";

/**
 * One college's card on the Essays tab (specs/product/essays/tab.md "The screen"): the name, round, and deadline from
 * the plan, the ready count, a Package link once anything is started, and one row per prompt (required first, then a
 * choose set under its "Choose 1 of 5" heading, then optional ones), each with its state glyph, its title, and on the
 * right the status with the count or **Start**. A college whose prompts we haven't read says so and offers "Add what
 * {College} asks" (the picker, that college chosen). Also the personal essay's card and the prompt row the Coalition
 * fold reuses. Rows are 44 px targets; a status wraps under its title on a narrow phone; no essay text anywhere (a
 * prompt's text is the college's own words).
 *
 * A row's title unfolds the whole prompt (owner, 2026-10-30: the short title stays, "clicking will expand and show
 * everything"): a `<details>` whose summary is the glyph and title, with the college's full prompt beneath. The
 * status on the right ("Draft · 180 of 250 words") is the link to the draft; Start is where it was. A prompt whose
 * text isn't on file (an own ref) has a plain title.
 *
 * Start creates the draft for that prompt (`createEssay`) and opens the editor; a guardian sees the same card with
 * Start and Add hidden (only the student writes).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { PromptPicker } from "@/components/essays/PromptPicker";
import { track } from "@/lib/analytics";
import { countLabel } from "@/lib/essays/count";
import type { CollegeEssayProgress, EssayProgress, PromptProgress, PromptState } from "@/lib/essays/progress";
import { MAIN_REF, type PickerGroup } from "@/lib/essays/prompts";
import { createEssay } from "@/lib/essays/store";
import {
  alsoUsedFor,
  anyStarted,
  collegeDone,
  collegeHeading,
  collegeNote,
  collegeStatus,
  editorHref,
  GLYPH,
  packageHref,
  promptTitle,
  STATE_WORD,
  stateLine,
  suggestionNote,
} from "@/lib/essays/tab-view";
import { collegeAnchor } from "@/lib/planner/plan-tabs";
import { cn } from "@/lib/utils";

const ROW = "flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5";
const STATE_TONE: Record<PromptState, string> = { not_started: "text-muted-foreground", draft: "text-muted-foreground", ready: "text-primary" };

/** "Start": creates the draft for one prompt and opens the editor (tab.md; `essay_started_from {where: "tab"}`). */
export function StartButton({ promptRef, person, label = "Start" }: { promptRef: string; person: string | null; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const go = () =>
    start(async () => {
      setMessage(null);
      const r = await createEssay(promptRef);
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      track("essay_created", { prompt_kind: r.kind });
      track("essay_started_from", { where: "tab" });
      router.push(editorHref(r.id, person));
    });
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted disabled:opacity-60"
      >
        {pending ? "Starting…" : label}
      </button>
      {message && (
        <span className="mt-1 text-xs text-destructive" role="status">
          {message}
        </span>
      )}
    </span>
  );
}

function Glyph({ state }: { state: PromptState }) {
  return (
    <span className={cn("mt-0.5 shrink-0 text-base leading-none", STATE_TONE[state])} aria-hidden>
      {GLYPH[state]}
    </span>
  );
}

/** One prompt's row: a link to the draft when there is one, else the title with Start (a student) or "Not started" (a guardian). */
export function PromptRow({
  p,
  text,
  also,
  comments,
  suggestion = null,
  person,
  canWrite,
}: {
  p: PromptProgress;
  /** The prompt's own words (the college's), for a vague kind's first words; null when not on file. */
  text: string | null;
  also: string | null;
  comments: number;
  /** "2 suggestions" or "Waiting for {first}" beside the comment count (tab-view.ts `suggestionNote`); null to show nothing. */
  suggestion?: string | null;
  person: string | null;
  canWrite: boolean;
}) {
  const title = promptTitle(p, text);
  const right = stateLine(p);
  const heading = (
    <span className="min-w-0 flex-1">
      <span className="sr-only">{STATE_WORD[p.state]}: </span>
      <span className="block font-semibold break-words">{title}</span>
      {(also || comments > 0 || suggestion) && (
        <span className="block text-xs text-muted-foreground">
          {[also, comments > 0 ? `${comments} ${comments === 1 ? "comment" : "comments"}` : null, suggestion].filter(Boolean).join(" · ")}
        </span>
      )}
    </span>
  );
  // The title unfolds the whole prompt when its text is on file; a summary is a 44 px target and keyboard-reachable.
  const left = text ? (
    <details className="group min-w-0 flex-1" data-prompt-fold>
      <summary className="-mx-1 flex min-h-11 cursor-pointer list-none items-start gap-2.5 rounded-xl px-1 py-0.5 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <Glyph state={p.state} />
        {heading}
        <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <p className="mt-1 pb-1 pl-[26px] text-sm whitespace-pre-line text-muted-foreground" data-prompt-text>
        {text}
      </p>
    </details>
  ) : (
    <span className="flex min-w-0 flex-1 items-start gap-2.5">
      <Glyph state={p.state} />
      {heading}
    </span>
  );
  const status = p.essayId ? (
    <Link
      href={editorHref(p.essayId, person)}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center self-start rounded-full px-2 text-sm tabular-nums hover:bg-muted/50 hover:underline",
        p.state === "ready" ? "font-semibold text-primary" : "text-muted-foreground",
      )}
      data-open-draft
    >
      {right}
      <span className="sr-only">: open the draft</span>
    </Link>
  ) : canWrite ? (
    <span className="shrink-0 self-start">
      <StartButton promptRef={p.ref} person={person} />
    </span>
  ) : (
    <span className="shrink-0 self-start py-2.5 text-sm text-muted-foreground">{STATE_WORD.not_started}</span>
  );
  return (
    <li data-prompt-row={p.state} className={cn(ROW, "items-start")}>
      {left}
      {status}
    </li>
  );
}

/** The personal essay's card (tab.md): status, count against 650, how many colleges use it; opens (or starts) the one main draft. */
export function MainEssayCard({
  main,
  usedBy,
  person,
  canWrite,
  comments,
  suggestion = null,
}: {
  main: NonNullable<EssayProgress["main"]>;
  usedBy: number;
  person: string | null;
  canWrite: boolean;
  comments: number;
  /** "2 suggestions" or "Waiting for {first}" beside the comment count (tab-view.ts `suggestionNote`); null to show nothing. */
  suggestion?: string | null;
}) {
  const count = countLabel(main.count, { kind: "words", max: main.limit }, "words");
  const bits = [
    STATE_WORD[main.state],
    main.state === "not_started" ? null : count,
    usedBy > 0 ? `used by ${usedBy} ${usedBy === 1 ? "college" : "colleges"}` : null,
    comments > 0 ? `${comments} ${comments === 1 ? "comment" : "comments"}` : null,
    suggestion,
  ].filter(Boolean);
  const body = (
    <>
      <span className="min-w-0">
        <span className="block text-xs font-semibold tracking-wide text-muted-foreground uppercase">Personal essay · Common App</span>
        <span className="mt-1 flex items-start gap-2.5">
          <Glyph state={main.state} />
          <span className="text-sm">{bits.join(" · ")}</span>
        </span>
      </span>
    </>
  );
  return (
    <section aria-label="Personal essay" data-main-essay className="rounded-3xl border bg-card">
      {main.essayId ? (
        <Link href={editorHref(main.essayId, person)} className="flex min-h-14 items-center justify-between gap-3 rounded-3xl px-4 py-3 hover:bg-muted/50 sm:px-5">
          {body}
        </Link>
      ) : (
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          {body}
          {canWrite && <StartButton promptRef={MAIN_REF} person={person} />}
        </div>
      )}
    </section>
  );
}

/** One college's card. */
export function CollegeEssayCard({
  college: c,
  texts,
  byEssay,
  openComments,
  openSuggestions = {},
  mySuggestions = {},
  viewer = "student",
  studentFirst = null,
  person,
  canWrite,
  picker,
  dated = true,
  ownRef = null,
}: {
  college: CollegeEssayProgress;
  texts: Record<string, string>;
  byEssay: Record<string, { unit_id: string; name: string }[]>;
  openComments: Record<string, number>;
  /** Open suggestions per draft id (tab-view.ts `suggestionNote`); empty when the read didn't carry any. */
  openSuggestions?: Record<string, number>;
  /** A guardian's own newest suggestion's state per draft id. */
  mySuggestions?: Record<string, "open" | "decided">;
  /** Whose screen this is, for `suggestionNote`'s two readings. */
  viewer?: "student" | "guardian";
  /** The student's first name, for a guardian's "Waiting for {first}". */
  studentFirst?: string | null;
  person: string | null;
  canWrite: boolean;
  picker: PickerGroup[];
  /** False before senior year: the round and its date aren't picked yet (list.md "Round picked senior year"), so the heading is the name alone. */
  dated?: boolean;
  /** The prompt ref "Add what {College} asks" starts a draft on (the college's next own ref); null: the free prompt. */
  ownRef?: string | null;
}) {
  const fixed = c.required.filter((p) => !p.chooseGroup);
  const chosen = c.required.filter((p) => p.chooseGroup);
  const choose = chosen[0]?.chooseGroup ?? null;
  const note = collegeNote(c);
  const done = collegeDone(c);
  const row = (p: PromptProgress) => (
    <PromptRow
      key={p.ref}
      p={p}
      text={texts[p.ref] ?? null}
      also={alsoUsedFor(byEssay, p.essayId, c.unit_id)}
      comments={p.essayId ? (openComments[p.essayId] ?? 0) : 0}
      suggestion={p.essayId ? suggestionNote(viewer, openSuggestions[p.essayId] ?? 0, mySuggestions[p.essayId], studentFirst) : null}
      person={person}
      canWrite={canWrite}
    />
  );
  const sub = (label: string) => <li className="bg-muted/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground">{label}</li>;

  return (
    <section id={collegeAnchor(c.unit_id)} aria-label={c.name} data-college={c.unit_id} className="scroll-mt-20 rounded-3xl border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-3 pb-2 sm:px-5">
        <h3 className="min-w-0 font-semibold break-words">{collegeHeading(dated ? c : { name: c.name, round: null, deadline: null })}</h3>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span className={cn(done && "font-semibold text-primary")} data-college-status>
            {collegeStatus(c)}
            {done && <Check className="ml-1 inline size-4" aria-label="all ready" />}
          </span>
          {anyStarted(c) && (
            <>
              <span aria-hidden>·</span>
              <Link href={packageHref(c.unit_id, person)} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                Package
              </Link>
            </>
          )}
        </p>
      </header>
      {note && (
        <div className="space-y-2 px-4 pb-3 sm:px-5">
          <p className="text-sm text-muted-foreground" data-college-note>
            {note}
          </p>
          {canWrite && !c.confirmedOn && <PromptPicker groups={picker} person={person} label={`Add what ${c.name} asks`} primary={false} college={{ unit_id: c.unit_id, name: c.name, ownRef }} />}
        </div>
      )}
      {(fixed.length > 0 || chosen.length > 0 || c.optional.length > 0 || c.own.length > 0) && (
        <ul className="divide-y border-t">
          {fixed.map(row)}
          {choose && sub(`Choose ${choose.n} of ${choose.of}`)}
          {chosen.map(row)}
          {c.optional.length > 0 && sub("Optional")}
          {c.optional.map(row)}
          {c.own.length > 0 && sub("Your own")}
          {c.own.map((o) => (
            <li key={o.id} data-prompt-row={o.state}>
              <Link href={editorHref(o.id, person)} className={cn(ROW, "hover:bg-muted/50")}>
                <span className="flex min-w-0 flex-1 items-start gap-2.5">
                  <Glyph state={o.state} />
                  <span className="block min-w-0 font-semibold break-words">{o.title}</span>
                </span>
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{o.state === "ready" ? STATE_WORD.ready : `${STATE_WORD[o.state]}${o.count !== null ? ` · ${countLabel(o.count, null)}` : ""}`}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default CollegeEssayCard;
