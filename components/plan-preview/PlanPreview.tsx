"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { CalendarDays, Heart, ListChecks, Pencil, Sparkles, Target } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TEST_LABEL, TEST_MAX, TEST_MIN, type TestKind } from "@/lib/planner/standing";
import { cn } from "@/lib/utils";
import { derive, initialState, type KidState } from "./derive";
import { ListView } from "./ListView";
import { ScoresView } from "./ScoresView";
import { CalendarView } from "./CalendarView";
import { KID_VARS, ROUND_VAR, dayLabel, daysBetween, type PreviewEntry, type PreviewKid } from "./types";
import { ROUND_SHORT } from "@/lib/planner/rounds";

export type { PreviewEntry, PreviewKid, PreviewSchool } from "./types";

const noSubscribe = () => () => {};
/** The visitor's local date as yyyy-mm-dd (a string, so the snapshot is stable between renders). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Viewer = string; // a kid's id, or "parent"
type Tab = "list" | "scores" | "calendar";

/**
 * The redesigned Plan page as a clickable preview (specs/planner/redesign/README.md "The page"). Preview as either
 * student or as their parent; change a score, the Dream, a group, or a round and everything downstream re-runs.
 * Nothing is saved.
 */
export function PlanPreview({ kids, entries, today: builtOn }: { kids: PreviewKid[]; entries: PreviewEntry[]; today: string }) {
  // The page is static, so the server's "today" is the build's day; the browser counts from the visitor's own.
  const today = useSyncExternalStore(noSubscribe, localToday, () => builtOn);
  const [viewer, setViewer] = useState<Viewer>(kids[0].id);
  const [parentKid, setParentKid] = useState<string>("all");
  const [tab, setTab] = useState<Tab>("list");
  const [states, setStates] = useState<Record<string, KidState>>(() => Object.fromEntries(kids.map((k) => [k.id, initialState(k)])));
  const [setup, setSetup] = useState<{ kid: string; step: 1 | 2 } | null>(null);

  const derived = useMemo(() => Object.fromEntries(kids.map((k) => [k.id, derive(k, states[k.id], today)])), [kids, states, today]);
  const update = (id: string, f: (s: KidState) => KidState) => setStates((all) => ({ ...all, [id]: f(all[id]) }));

  const isParent = viewer === "parent";
  const activeId = isParent ? (parentKid === "all" ? null : parentKid) : viewer;
  const kid = activeId ? kids.find((k) => k.id === activeId)! : null;
  const kidColor = (id: string) => KID_VARS[kids.findIndex((k) => k.id === id) % KID_VARS.length];
  const effectiveTab: Tab = kid ? tab : "calendar";

  const chooseViewer = (v: Viewer) => {
    setViewer(v);
    setSetup(null);
    setTab(v === "parent" ? "calendar" : "list");
    if (v === "parent") setParentKid("all");
  };

  return (
    <div className="pv mx-auto max-w-5xl space-y-6">
      {/* Preview chrome: what this page is, the proposed navigation, and who you're looking as. */}
      <div className="space-y-3 rounded-3xl border border-dashed bg-muted/40 p-4 text-sm">
        <p>
          <span className="font-semibold">Design preview.</span> A made-up family over real college records. Change anything; nothing is saved. The spec is on the{" "}
          <Link href="/roadmap/planner-redesign" className="font-semibold text-primary hover:underline">
            roadmap
          </Link>
          .
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Proposed top navigation:</span>
          {["Explore", "Plan", "Compare", "High schools", "Glossary", "Data"].map((n) => (
            <span key={n} className={cn("rounded-full px-3 py-1 text-xs font-semibold", n === "Plan" ? "bg-foreground text-background" : "text-muted-foreground")}>
              {n}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Preview as:</span>
          <SegmentedControl
            label="Preview as"
            value={viewer}
            onChange={chooseViewer}
            options={[...kids.map((k) => ({ value: k.id, label: `${k.name} (student)` })), { value: "parent", label: "Their parent" }]}
          />
          {!isParent && (
            <button type="button" onClick={() => setSetup({ kid: viewer, step: 1 })} className="text-xs font-semibold text-primary hover:underline">
              Replay first-time setup
            </button>
          )}
        </div>
      </div>

      {/* Parent: one switcher for the family, each child in their own color everywhere. */}
      {isParent && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Whose plan">
          {[...kids.map((k) => ({ id: k.id, label: k.name, sub: `Class of ${k.gradYear}` })), { id: "all", label: "Everyone", sub: "One calendar" }].map((k) => {
            const on = parentKid === k.id;
            return (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setParentKid(k.id)}
                className={cn("flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-colors", on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")}
              >
                {k.id === "all" ? (
                  <span className="flex -space-x-1">
                    {kids.map((x) => (
                      <span key={x.id} className="size-3 rounded-full ring-2 ring-card" style={{ background: kidColor(x.id) }} />
                    ))}
                  </span>
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: kidColor(k.id) }}>
                    {k.label[0]}
                  </span>
                )}
                <span>
                  <span className="block text-sm font-bold leading-tight">{k.label}</span>
                  <span className={cn("block text-[11px] leading-tight", on ? "opacity-80" : "text-muted-foreground")}>{k.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {setup && kid && setup.kid === kid.id ? (
        <Setup
          kid={kid}
          state={states[kid.id]}
          step={setup.step}
          onState={(f) => update(kid.id, f)}
          onNext={() => (setup.step === 1 ? setSetup({ kid: kid.id, step: 2 }) : (setSetup(null), setTab("list")))}
        />
      ) : (
        <>
          {kid && (
            <KidHeader
              kid={kid}
              state={states[kid.id]}
              derived={derived[kid.id]}
              today={today}
              isParent={isParent}
              color={kidColor(kid.id)}
              onState={(f) => update(kid.id, f)}
            />
          )}

          {kid && (
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Plan views">
              {(
                [
                  { value: "list", label: "Colleges", icon: ListChecks },
                  { value: "scores", label: "Scores", icon: Target },
                  { value: "calendar", label: "Calendar", icon: CalendarDays },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={effectiveTab === value}
                  onClick={() => setTab(value)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
                    effectiveTab === value ? "bg-foreground text-background" : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                  {value === "scores" && derived[kid.id].retake && <span className="size-2 rounded-full bg-pop" aria-label="has a suggestion" />}
                </button>
              ))}
            </div>
          )}

          {kid && effectiveTab === "list" && (
            <ListView kid={kid} derived={derived[kid.id]} today={today} isParent={isParent} onState={(f) => update(kid.id, f)} onScores={() => setTab("scores")} />
          )}
          {kid && effectiveTab === "scores" && (
            <ScoresView kid={kid} state={states[kid.id]} derived={derived[kid.id]} entries={entries} today={today} isParent={isParent} onState={(f) => update(kid.id, f)} />
          )}
          {effectiveTab === "calendar" && (
            <CalendarView key={kid ? kid.id : "all"} kids={kid ? [kid] : kids} derived={derived} entries={entries} today={today} isParent={isParent} kidColor={kidColor} everyone={!kid} />
          )}
        </>
      )}
    </div>
  );
}

/** The student's name, class, numbers in one line (editable in place), and the one next thing. */
function KidHeader({
  kid,
  state,
  derived,
  today,
  isParent,
  color,
  onState,
}: {
  kid: PreviewKid;
  state: KidState;
  derived: ReturnType<typeof derive>;
  today: string;
  isParent: boolean;
  color: string;
  onState: (f: (s: KidState) => KidState) => void;
}) {
  const [editing, setEditing] = useState(false);
  const senior = kid.cycleStart <= Number(today.slice(0, 4)) && today >= `${kid.cycleStart}-08-01`;
  const next = derived.next;
  return (
    <section className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <div className="rounded-3xl border bg-card p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full text-base font-bold text-white" style={{ background: color }}>
            {kid.name[0]}
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold leading-tight">{isParent ? `${kid.name}'s plan` : "Your plan"}</h1>
            <p className="text-sm text-muted-foreground">
              Class of {kid.gradYear} · {senior ? "applying this fall" : "building the list"}
            </p>
          </div>
        </div>
        {editing ? (
          <NumbersForm state={state} onState={onState} onDone={() => setEditing(false)} />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-left text-sm hover:bg-muted">
            <span className="font-semibold">GPA {state.gpa?.toFixed(2) ?? "—"}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-semibold">{state.test ? `${TEST_LABEL[state.test.kind]} ${state.test.score}` : "Not testing"}</span>
            <Pencil className="ml-1 size-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Change a number and the groups re-sort</span>
          </button>
        )}
      </div>
      <div className="flex min-w-60 flex-col justify-center rounded-3xl bg-foreground p-5 text-background">
        <p className="text-xs font-bold tracking-wide uppercase opacity-80">Next up</p>
        {next?.deadline ? (
          <>
            <p className="mt-1 font-display text-xl leading-tight font-bold">{next.school.name}</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
              <span className="size-3 rotate-45" style={{ background: ROUND_VAR[next.round] }} aria-hidden />
              {ROUND_SHORT[next.round]} due {dayLabel(next.deadline.iso)} · {daysBetween(today, next.deadline.iso)} days
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm font-semibold">{senior ? "No deadlines on record yet" : `Applications open Aug 1, ${kid.cycleStart}`}</p>
        )}
      </div>
    </section>
  );
}

/** Three things: GPA, which test, the score. "Not testing" is a real answer. */
export function NumbersForm({ state, onState, onDone }: { state: KidState; onState: (f: (s: KidState) => KidState) => void; onDone?: () => void }) {
  const kind: TestKind | "none" = state.test?.kind ?? "none";
  const setKind = (k: TestKind | "none") =>
    onState((s) => ({ ...s, test: k === "none" ? null : { kind: k, score: s.test?.kind === k ? s.test.score : k === "sat" ? 1200 : 25 } }));
  return (
    <div className="mt-4 space-y-4 rounded-2xl bg-muted/50 p-4">
      <label className="block text-sm font-semibold">
        Unweighted GPA
        <input
          type="number"
          step="0.01"
          min={0}
          max={4}
          value={state.gpa ?? ""}
          onChange={(e) => onState((s) => ({ ...s, gpa: e.target.value === "" ? null : Math.min(4, Math.max(0, Number(e.target.value))) }))}
          className="mt-1 block h-11 w-32 rounded-xl border bg-background px-3 text-base"
        />
      </label>
      <div className="space-y-1">
        <p className="text-sm font-semibold">Which test are you taking?</p>
        <SegmentedControl
          label="Which test"
          value={kind}
          onChange={setKind}
          options={[
            { value: "sat", label: "SAT" },
            { value: "act", label: "ACT" },
            { value: "none", label: "Not testing" },
          ]}
        />
        <p className="text-xs text-muted-foreground">Most students pick one and work on it. If you haven&apos;t taken it yet, use a practice score.</p>
      </div>
      {state.test && (
        <label className="block text-sm font-semibold">
          Best {TEST_LABEL[state.test.kind]} score
          <div className="mt-1 flex items-center gap-3">
            <input
              type="range"
              min={state.test.kind === "sat" ? 900 : 15}
              max={TEST_MAX[state.test.kind]}
              step={state.test.kind === "sat" ? 10 : 1}
              value={state.test.score}
              onChange={(e) => onState((s) => ({ ...s, test: s.test && { ...s.test, score: Number(e.target.value) } }))}
              className="w-56"
            />
            <input
              type="number"
              min={TEST_MIN[state.test.kind]}
              max={TEST_MAX[state.test.kind]}
              value={state.test.score}
              onChange={(e) => onState((s) => ({ ...s, test: s.test && { ...s.test, score: Number(e.target.value) } }))}
              className="h-11 w-24 rounded-xl border bg-background px-3 text-base"
            />
          </div>
        </label>
      )}
      {onDone && (
        <button type="button" onClick={onDone} className="h-11 rounded-full bg-foreground px-5 text-sm font-semibold text-background">
          Done
        </button>
      )}
    </div>
  );
}

/** First-time setup: numbers, then the Dream. The list is already there (added from Explore and profiles). */
function Setup({
  kid,
  state,
  step,
  onState,
  onNext,
}: {
  kid: PreviewKid;
  state: KidState;
  step: 1 | 2;
  onState: (f: (s: KidState) => KidState) => void;
  onNext: () => void;
}) {
  return (
    <section className="mx-auto max-w-xl rounded-3xl border bg-card p-6">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Step {step} of 2</p>
      {step === 1 ? (
        <>
          <h2 className="mt-1 font-display text-2xl font-bold">Start with your numbers</h2>
          <p className="mt-1 text-sm text-muted-foreground">We use them to sort your colleges into Reach, Target, and Likely. You can change any of it later.</p>
          <NumbersForm state={state} onState={onState} />
        </>
      ) : (
        <>
          <h2 className="mt-1 font-display text-2xl font-bold">Is there a Dream school?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The one you&apos;d pick over all the others today. If it has an early decision round, your plan starts it there. Skip it if there isn&apos;t one yet.
          </p>
          <ul className="mt-4 space-y-1">
            {kid.schools.map((s) => {
              const on = state.dream === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onState((st) => ({ ...st, dream: on ? null : s.id }))}
                    className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold", on ? "bg-rose-50 dark:bg-rose-950/40" : "hover:bg-muted")}
                  >
                    <Heart className={cn("size-5", on ? "fill-rose-500 text-rose-500" : "text-muted-foreground")} />
                    {s.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button type="button" onClick={onNext} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background">
        {step === 1 ? "Next" : (
          <>
            <Sparkles className="size-4" /> Show my plan
          </>
        )}
      </button>
    </section>
  );
}
