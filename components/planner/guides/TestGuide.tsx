"use client";

/**
 * Reach your score (specs/planner/v3/guides/test-prep.md): the student's own numbers, where the current score
 * stands on the list (and what the target would change), study resources for the focus test, the upcoming dates
 * with registration tracked like a tour, and the dates already on the calendar. Never a probability, an admit rate,
 * or the word "odds"; the score and target are the student's own and never leave this page (no email, no parent
 * view, no telemetry carries them). A guardian reads the same page in the third person.
 */
import Link from "next/link";
import { RangeBar } from "@/components/charts/RangeBar";
import { MetricLabel } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { DOMAINS } from "@/lib/metrics";
import { SECTION_STEP } from "@/lib/planner/profile-progress";
import { planHref } from "@/lib/planner/plan-tabs";
import { setPlannedDate } from "@/lib/planner/store-plan";
import { TEST_LABEL, type TestKind } from "@/lib/planner/standing";
import { dayLabel, plannedState, resourcesFor, standingCounts, type StandingRow, type TestDateEntry, type TestGuideData } from "@/lib/planner/test-guide";
import { ReturnPrompt, useInterestActs } from "./ReturnPrompt";
import { TestDateRow } from "./TestDateRow";
import type { GuideProps } from "./types";

/** The chart's axis for each test (the deleted Scores tab's `components/planner/ScoreRow.tsx` AXIS): fixed regardless of the student's own score. */
const AXIS: Record<TestKind, [number, number]> = { sat: [1000, 1600], act: [18, 36] };

export function TestGuide(props: GuideProps) {
  const data = (props.data as TestGuideData | undefined) ?? { dates: [], standing: [], pending: [] };
  return (
    <ReturnPrompt initial={data.pending} collegeName={null} zones={{}}>
      <TestGuideBody {...props} data={data} />
    </ReturnPrompt>
  );
}

export default TestGuide;

function TestGuideBody({ ctx, view, person, data }: GuideProps & { data: TestGuideData }) {
  const profile = ctx.profile;
  const isGuardian = ctx.viewer.isGuardian;
  const first = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const focus = profile?.tests.focus ?? null;
  const studentId = ctx.student?.id ?? null;
  const canEdit = ctx.viewer.canEdit;
  const testStep = typeof SECTION_STEP.test === "number" ? SECTION_STEP.test : undefined;

  if (!profile || focus === null || (focus !== "none" && profile.tests[focus === "sat" ? "satTotal" : "actComposite"] === null)) {
    return (
      <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
        <p className="text-sm text-muted-foreground">
          {isGuardian ? `Add ${first ?? "their"} SAT or ACT score` : "Add your SAT or ACT score"} to see where it stands and the dates for the test.{" "}
          <Link href={planHref({ person, setup: true, step: testStep })} className="font-semibold text-primary hover:underline">
            Pick a test
          </Link>
          .
        </p>
      </section>
    );
  }

  if (focus === "none") {
    return (
      <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
        <p className="text-sm text-muted-foreground">{isGuardian ? `${first ?? "They"} is` : "You're"} not testing. The groups use {isGuardian ? "their" : "your"} GPA alone.</p>
      </section>
    );
  }

  const test = focus;
  const score = (test === "sat" ? profile.tests.satTotal : profile.tests.actComposite)!;
  const target = profile.tests.target;
  const practice = profile.tests.practice;

  const subject = isGuardian ? (first ?? "They") : "You";
  const verb = isGuardian ? "is" : "are";
  const header =
    target !== null
      ? `${subject} ${verb} at ${score} on the ${TEST_LABEL[test]}, aiming for ${target}.`
      : `${subject} ${verb} at ${score} on the ${TEST_LABEL[test]}.`;

  const sentence = standingCounts(data.standing, target);
  const study = resourcesFor(test);

  const planned = data.dates.filter((d) => plannedState(profile, d.key) !== null);

  return (
    <div className="min-w-0 space-y-5">
      <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
        <p className="font-display text-xl font-bold">
          {header}
          {practice && <span className="ml-2 text-sm font-semibold text-muted-foreground">(practice score)</span>}
        </p>
      </section>

      <section className="space-y-3 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5" aria-labelledby="test-standing">
        <h2 id="test-standing" className="font-display text-lg font-bold">
          Where {isGuardian ? (first ?? "it") : "it"} stands on {isGuardian ? "the" : "your"} list
        </h2>
        {sentence && <p className="text-sm text-muted-foreground">{sentence}</p>}
        <StandingRows rows={view.rows.filter((r) => !r.item.withdrawn_on && r.school)} standing={data.standing} test={test} />
      </section>

      <section className="space-y-2 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5" aria-labelledby="test-study">
        <h2 id="test-study" className="font-display text-lg font-bold">
          Study
        </h2>
        <p className="text-sm text-muted-foreground">Official, free, and the ones advisors point to first:</p>
        <ul className="space-y-1 text-sm">
          {study.resources.map((r) => (
            <li key={r.href}>
              <a href={r.href} target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">
                {r.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{study.cadence}</p>
      </section>

      <section className="space-y-3 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5" aria-labelledby="test-dates">
        <h2 id="test-dates" className="font-display text-lg font-bold">
          Upcoming {TEST_LABEL[test]} dates
        </h2>
        {data.dates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming dates on record yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.dates.map((d) => (
              <TestDateRow key={d.key} entry={d} kind={test} today={ctx.today} state={plannedState(profile, d.key)} studentId={studentId} canEdit={canEdit} />
            ))}
          </ul>
        )}
        <PendingTestLines />
        <p className="text-xs text-muted-foreground">
          Official dates:{" "}
          <a href="https://satsuite.collegeboard.org/sat/dates-deadlines" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">
            College Board ↗
          </a>{" "}
          ·{" "}
          <a href="https://www.act.org/content/act/en/products-and-services/the-act/registration/test-dates.html" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">
            ACT ↗
          </a>
        </p>
      </section>

      <section className="space-y-2 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5" aria-labelledby="test-calendar">
        <h2 id="test-calendar" className="font-display text-lg font-bold">
          On {isGuardian ? "the" : "your"} calendar
        </h2>
        {planned.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dates picked yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {planned.map((d) => (
              <CalendarRow key={d.key} entry={d} test={test} state={plannedState(profile, d.key)!} studentId={studentId} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StandingRows({ rows, standing, test }: { rows: readonly { school: { name: string; cites: Record<string, unknown> } | null }[]; standing: readonly StandingRow[]; test: TestKind }) {
  if (standing.length === 0) return <p className="text-sm text-muted-foreground">No colleges on the list yet.</p>;
  return (
    <ul className="space-y-3">
      {standing.map((row, i) => {
        const school = rows[i]?.school;
        const name = school?.name ?? "A college";
        const field = test === "sat" ? "derived.sat_total" : "admissions.act_composite_25_75";
        const cite = school?.cites?.[field] as AnyCited | undefined;
        return (
          <li key={i} className="space-y-1">
            <p className="text-sm font-semibold">{name}</p>
            {row.blind ? (
              <p className="text-xs text-muted-foreground">Test-blind: scores aren&apos;t read.</p>
            ) : row.score === null ? (
              <p className="text-xs text-muted-foreground">No range published.</p>
            ) : (
              <MetricLabel cited={cite}>
                <RangeBar label="" low={row.score.range[0]} high={row.score.range[1]} scale={AXIS[row.score.kind]} color={DOMAINS.scores.color} you={row.score.value} compact showScale />
              </MetricLabel>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PendingTestLines() {
  const acts = useInterestActs();
  if (!acts) return null;
  const rows = acts.pending.filter((r) => r.act === "test_register");
  if (!rows.length) return null;
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-2 rounded-2xl border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="font-semibold">Pending:</span> {lower(acts.question(row))}
          </span>
          <span className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={acts.busy}
              onClick={() => acts.confirm(row, "manual")}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60"
            >
              Yes
            </button>
            <button
              type="button"
              disabled={acts.busy}
              onClick={() => acts.later(row)}
              className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted disabled:opacity-60"
            >
              Not yet
            </button>
          </span>
        </li>
      ))}
      {acts.error && (
        <li role="alert" className="text-sm text-destructive">
          {acts.error}
        </li>
      )}
    </ul>
  );
}

function CalendarRow({ entry, test, state, studentId, canEdit }: { entry: TestDateEntry; test: TestKind; state: "planned" | "registered"; studentId: string | null; canEdit: boolean }) {
  const remove = () => {
    if (studentId) void setPlannedDate(studentId, entry.key, false);
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2">
      <span>
        <span className="font-semibold">{TEST_LABEL[test]}</span> · {dayLabel(entry.date)} ({state})
      </span>
      {canEdit && studentId && (
        <button type="button" onClick={remove} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
          Remove
        </button>
      )}
    </li>
  );
}
