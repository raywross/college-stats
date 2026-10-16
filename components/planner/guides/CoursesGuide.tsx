"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { X } from "lucide-react";
import Link from "next/link";
import { SourceTip } from "@/components/ui/info-tip";
import { saveCourses } from "@/lib/chances/courses-store";
import { newCourse, thirdPerson } from "@/lib/chances/courses";
import { dismissSuggestion, markScheduleDone, saveSchoolOffers } from "@/lib/chances/course-plan-store";
import { endpointFetch, ESTIMATE_MAX_COLLEGES, whatItChanges } from "@/lib/chances/course-plan-estimate";
import type { CoursePlanView, SuggestionView } from "@/lib/chances/course-plan-view";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import type { CourseTracks } from "@/lib/chances/depth";
import { noteText } from "@/lib/chances/notes";
import type { CourseSubject } from "@/lib/chances/types";
import { track } from "@/lib/analytics";
import { apName, POPULAR_AP, searchAp } from "@/lib/planner/intake";
import { planHref } from "@/lib/planner/plan-tabs";
import { tick } from "@/lib/planner/store";
import { isOpen } from "@/lib/planner/tasks";
import { courseRows, kindMark, nextYearCourses, type CourseRow } from "@/lib/planner/courses-guide";
import { cn } from "@/lib/utils";
import type { GuideProps } from "./types";

/** What the guide's server `load` sends down (lib/planner/guides-server.ts "courses" entry). */
export interface CoursesGuideData {
  plan: CoursePlanView | null;
  tracks: CourseTracks | null;
}

const STATUS_WORD: Record<"taken" | "in_progress" | "planned", string | null> = { taken: null, in_progress: "now", planned: "planned" };

/**
 * Choose next year's APs (specs/planner/v3/guides/ap-choices.md): the course list by subject track, the built
 * suggestions restored from `components/planner/NextYearCard.tsx` (now deleted; this is its new home), the AP search
 * to add anything else, and the one tap that marks next year's schedule chosen. Every change is a profile save, so
 * the Numbers page, the rigor reading, the estimate, and the depth tracks read it at once. A guardian is read-only.
 */
export function CoursesGuide({ ctx, move, person, data }: GuideProps) {
  const { plan, tracks } = (data as CoursesGuideData | undefined) ?? { plan: null, tracks: null };
  const profile = ctx.profile;
  const isGuardian = ctx.viewer.isGuardian;
  const editable = ctx.viewer.canEdit && !isGuardian;
  const studentId = ctx.student?.id ?? null;
  const first = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const say = (t: string) => (isGuardian ? thirdPerson(t, first) : t);

  const shown = useRef(false);
  useEffect(() => {
    if (!plan || plan.kind === "none" || shown.current) return;
    shown.current = true;
    track("course_plan_shown", { reasons: plan.telemetry.reasons, guardrail: plan.telemetry.guardrail });
  }, [plan]);

  if (!profile || !studentId) {
    return (
      <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
        <p className="text-sm text-muted-foreground">
          Add your courses to see your choices for next year.{" "}
          <Link href={planHref({ person, setup: true, step: 2 })} className="font-semibold text-primary hover:underline">
            Add them
          </Link>
          .
        </p>
      </section>
    );
  }

  const classYear = profile.basics.gradYear ?? ctx.gradYear;
  const rows = courseRows(profile.academics.courses, classYear, ctx.today, tracks?.families.filter((f) => f.expected).map((f) => f.family) ?? []);
  const nextYear = plan?.nextYear ?? rows.find((r) => r.nextYear !== null)?.nextYear ?? null;
  const openMove = move && isOpen(move, ctx.today) ? move : null;

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Schools ask for next year&apos;s choices in late winter. Colleges read the courses as closely as the grades.
      </p>

      <WhatYouveTaken rows={rows} tracks={tracks} say={say} person={person} />

      {/* Once the schedule's chosen, the suggestions fold (ap-choices.md "Chosen"). */}
      {plan && plan.kind !== "none" && !plan.done && (
        <Suggestions plan={plan} profile={profile} studentId={studentId} ctx={ctx} say={say} editable={editable} tracks={tracks} />
      )}

      <AddAnythingElse profile={profile} studentId={studentId} nextYear={nextYear} editable={editable} />

      {editable && plan && plan.kind !== "none" && (
        <ChosenButton studentId={studentId} done={plan.done} move={openMove?.id ?? null} />
      )}
    </div>
  );
}

function WhatYouveTaken({
  rows,
  tracks,
  say,
  person,
}: {
  rows: CourseRow[];
  tracks: CourseTracks | null;
  say: (t: string) => string;
  person: string | null;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">What you&apos;ve taken</h2>
        <Link href={planHref({ person, setup: true, step: 2 })} className="text-sm font-semibold text-primary hover:underline">
          Edit
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No courses on your list yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const familyTrack = tracks?.families.find((f) => f.family === row.family);
            return (
              <li key={row.family} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl border bg-card p-3.5">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-sm font-semibold">{row.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {row.cells.map((cell, i) => (
                      <span key={cell.year}>
                        {i > 0 && " → "}
                        {cell.courses.map((c, j) => (
                          <span key={c.id}>
                            {j > 0 && ", "}
                            {c.name}
                            {kindMark(c.kind) && ` (${kindMark(c.kind)})`}
                            {STATUS_WORD[c.status] && ` (${STATUS_WORD[c.status]})`}
                          </span>
                        ))}
                      </span>
                    ))}
                    {row.nextYear !== null && " → ?"}
                  </span>
                </div>
                {familyTrack && <p className="max-w-xs text-right text-xs text-muted-foreground">{say(noteText(familyTrack.note))}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Suggestions({
  plan,
  profile,
  studentId,
  ctx,
  say,
  editable,
  tracks,
}: {
  plan: CoursePlanView;
  profile: NonNullable<GuideProps["ctx"]["profile"]>;
  studentId: string;
  ctx: GuideProps["ctx"];
  say: (t: string) => string;
  editable: boolean;
  tracks: CourseTracks | null;
}) {
  const colleges = useMemo(
    () =>
      ctx.items
        .filter((i) => !i.withdrawn_on)
        .map((i) => ({ unitId: i.unit_id, name: ctx.schools[i.unit_id]?.name ?? "" }))
        .filter((c) => c.name !== "")
        .slice(0, ESTIMATE_MAX_COLLEGES),
    [ctx.items, ctx.schools],
  );
  const [changes, setChanges] = useState<Record<string, string>>({});
  const keys = plan.suggestions.map((s) => s.key).filter((k): k is string => k !== null);
  const signature = keys.join("|");
  useEffect(() => {
    if (colleges.length === 0 || keys.length === 0) return;
    let cancelled = false;
    const fetchEstimate = endpointFetch();
    (async () => {
      const unitIds = colleges.map((c) => c.unitId);
      const base = await fetchEstimate({ student: estimateInputFromProfile(profile, unitIds[0], null).student, unitIds });
      if (!base || cancelled) return;
      for (const s of plan.suggestions) {
        if (!s.key) continue;
        const course = newCourse({ kind: "ap", key: s.key, grade: plan.grade, year: s.year });
        const line = await whatItChanges({ profile, colleges, course, fetchEstimate, base });
        if (cancelled) return;
        if (line) setChanges((prev) => ({ ...prev, [s.id]: line }));
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The suggestions' keys are what the question depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, colleges.length, profile.academics.courses.length]);

  if (plan.kind === "path") {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">On the way to your major</h2>
        <ul className="space-y-1.5 text-sm">
          {plan.path.map((t) => (
            <li key={t}>{say(t)}</li>
          ))}
        </ul>
      </section>
    );
  }

  if (plan.kind !== "suggestions" || plan.suggestions.length === 0) {
    return plan.messages.length > 0 ? (
      <section className="space-y-1 text-sm text-muted-foreground">
        {plan.messages.map((t) => (
          <p key={t}>{say(t)}</p>
        ))}
      </section>
    ) : null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">Suggested for next year</h2>
      <ul className="space-y-3">
        {plan.suggestions.map((s) => (
          <SuggestionRow
            key={s.id}
            s={s}
            plan={plan}
            studentId={studentId}
            profile={profile}
            say={say}
            changeLine={changes[s.id] ?? null}
            editable={editable}
            depthTie={depthTieFor(tracks, s.subject)}
          />
        ))}
      </ul>
    </section>
  );
}

/** "A fourth year makes this a deep track": a suggestion that continues a Steady track in the same family says so. */
function depthTieFor(tracks: CourseTracks | null, subject: CourseSubject): string | null {
  const f = tracks?.families.find((x) => x.family === subject);
  return f && f.reading === "steady" ? "A fourth year makes this a deep track." : null;
}

function SuggestionRow({
  s,
  plan,
  studentId,
  profile,
  say,
  changeLine,
  editable,
  depthTie,
}: {
  s: SuggestionView;
  plan: CoursePlanView;
  studentId: string;
  profile: NonNullable<GuideProps["ctx"]["profile"]>;
  say: (t: string) => string;
  changeLine: string | null;
  editable: boolean;
  depthTie: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!s.key) return;
    setError(null);
    startTransition(async () => {
      const row = newCourse({ kind: "ap", key: s.key, grade: plan.grade, year: s.year });
      const result = await saveCourses(studentId, { courses: [...profile.academics.courses, row], coreAtTopLevel: profile.academics.coreAtTopLevel, apExamsPrivate: profile.academics.apExamsPrivate });
      if (!result.ok) setError(result.message);
      else {
        track("course_plan_added", { reason: s.reason });
        track("plan_courses_added", { count: 1 });
      }
    });
  };
  const notForMe = () => {
    setError(null);
    startTransition(async () => {
      const result = await dismissSuggestion(studentId, s.id);
      if (!result.ok) setError(result.message);
      else track("course_plan_dismissed", { reason: s.reason });
    });
  };

  return (
    <li className="rounded-xl border bg-background p-3">
      <p className="font-semibold">{s.name}</p>
      <p className="mt-0.5">
        {say(s.sentence)}
        {s.evidence
          .filter((e) => e.cite)
          .slice(0, 3)
          .map((e) => (
            <SourceTip key={e.label} cited={e.cite!} className="mx-0.5" />
          ))}
      </p>
      {s.readingLine && <p className="mt-1 text-muted-foreground">{say(s.readingLine)}</p>}
      {changeLine && <p className="mt-1 text-muted-foreground">{say(changeLine)}</p>}
      {depthTie && <p className="mt-1 text-muted-foreground">{depthTie}</p>}
      {s.evidence.some((e) => e.href) && (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {s.evidence
            .filter((e) => e.href)
            .map((e) => (
              <a key={e.href} href={e.href} target="_blank" rel="noreferrer" className="break-words text-primary underline-offset-2 hover:underline">
                {e.label}
              </a>
            ))}
        </p>
      )}
      {editable && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {s.key && (
            <button type="button" onClick={add} disabled={pending} className="h-11 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:h-9">
              Add to next year
            </button>
          )}
          <button type="button" onClick={notForMe} disabled={pending} className="h-11 rounded-full border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60 sm:h-9">
            Not for me
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

function AddAnythingElse({
  profile,
  studentId,
  nextYear,
  editable,
}: {
  profile: NonNullable<GuideProps["ctx"]["profile"]>;
  studentId: string;
  nextYear: 10 | 11 | 12 | null;
  editable: boolean;
}) {
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const planned = nextYearCourses(profile.academics.courses, nextYear).filter((c) => c.key !== null);
  const exclude = planned.map((c) => c.key!);
  const matches = searchAp(query, exclude, 10);

  const add = (key: string) => {
    if (nextYear === null) return;
    setError(null);
    startTransition(async () => {
      // `grade` is today's grade (one less than `nextYear`), not null: newCourse's defaultStatus reads "taken"
      // without a grade, and this row is always a planned one for next year.
      const row = newCourse({ kind: "ap", key, grade: nextYear - 1, year: nextYear });
      const result = await saveCourses(studentId, { courses: [...profile.academics.courses, row], coreAtTopLevel: profile.academics.coreAtTopLevel, apExamsPrivate: profile.academics.apExamsPrivate });
      if (!result.ok) setError(result.message);
      else {
        track("plan_courses_added", { count: 1 });
        setQuery("");
      }
    });
  };

  const remove = (id: string) => {
    setError(null);
    startTransition(async () => {
      const result = await saveCourses(studentId, {
        courses: profile.academics.courses.filter((c) => c.id !== id),
        coreAtTopLevel: profile.academics.coreAtTopLevel,
        apExamsPrivate: profile.academics.apExamsPrivate,
      });
      if (!result.ok) setError(result.message);
    });
  };

  const markOffered = (key: string) => {
    startTransition(async () => {
      await saveSchoolOffers(studentId, [...new Set([...profile.academics.schoolOffers, key])]);
    });
  };

  if (nextYear === null) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">Add anything else you&apos;re taking</h2>
      {editable && (
        <div className="space-y-2">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search AP courses…"
              className="h-12 w-full rounded-full border px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(query.trim() === "" ? POPULAR_AP.filter((k) => !exclude.includes(k)) : matches.map((m) => m.key)).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => add(key)}
                disabled={pending}
                className="min-h-9 rounded-full border border-dashed px-3.5 text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-60"
              >
                + {apName(key)}
              </button>
            ))}
          </div>
        </div>
      )}

      {planned.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Next year so far</p>
          <ul className="flex flex-wrap gap-1.5">
            {planned.map((c) => {
              const notOnList = c.key !== null && !profile.academics.schoolOffers.includes(c.key);
              return (
                <li key={c.id} className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5">
                  <span className="text-sm font-semibold">{apName(c.key ?? "")}</span>
                  {notOnList && editable && (
                    <button type="button" onClick={() => markOffered(c.key!)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                      not on your school&apos;s list; tell us if it is
                    </button>
                  )}
                  {editable && (
                    <button type="button" onClick={() => remove(c.id)} aria-label={`Remove ${apName(c.key ?? "")}`} className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80">
                      <X className="size-3.5" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function ChosenButton({ studentId, done, move }: { studentId: string; done: boolean; move: string | null }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markScheduleDone(studentId, !done);
          if (!done && move) await tick(move);
        })
      }
      className={cn("h-11 rounded-full px-5 text-sm font-semibold disabled:opacity-60 sm:h-9", done ? "border hover:bg-muted" : "bg-primary text-primary-foreground")}
    >
      {done ? "Reopen next year's courses" : "Next year's courses are chosen ✓"}
    </button>
  );
}

export default CoursesGuide;
