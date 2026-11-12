/**
 * Every batch job the site runs (specs/product/admin-jobs.md "The jobs"): the console's own typed table, the way
 * lib/admin/workflows.ts is for the runs it can start. Two runners:
 * - `vercel`: a route under app/api/cron/, called by Vercel Cron on the schedule in vercel.json; its runs are the
 *   rows it writes to `job_runs` (lib/jobs/record.ts).
 * - `github`: a workflow in .github/workflows/, on its `on.schedule` crons or by hand; its runs are read from GitHub.
 * tests/jobs.test.mts holds this table to vercel.json and the workflows' `cron:` lines, so a schedule changed in one
 * place and not the other fails CI. Pure: the pages and tests import it.
 */
import { nextRun, parseCron } from "./cron.ts";

export type JobRunner = "vercel" | "github";

export interface JobSchedule {
  /** Five fields, UTC (lib/jobs/cron.ts). */
  cron: string;
  /** What this firing does, or when it does nothing, when that differs from the job's description. */
  note?: string;
  /** Months (1 to 12) in which a firing proceeds; the workflow exits at once in the others. */
  months?: readonly number[];
  /** False for a housekeeping firing that shouldn't count as the job's next run (the half-hourly collect). */
  headline?: boolean;
}

export interface JobDef {
  id: string;
  name: string;
  /** One or two sentences: what a run does. */
  description: string;
  runner: JobRunner;
  /** `vercel`: the route's path. */
  path?: string;
  /** `github`: the workflow's file name. */
  workflow?: string;
  schedules: readonly JobSchedule[];
  /** One sentence for a job whose firing may do nothing (a check decides), shown beside the schedule. */
  gate?: string;
  /** The spec that describes the job, repository-relative. */
  spec: string;
  /** The row of lib/admin/workflows.ts `DISPATCHABLE_RUNS` that marks this job as one Run now can start (its page lists every row for its workflow). */
  dispatch?: string;
  /** What a good run looks like, for the Steward's job review (lib/steward/job-review.ts). Every job in `JOBS` has one (tested). */
  expects?: JobExpectations;
}

/**
 * What the Steward expects of a job's run (specs/product/admin-redesign.md "What the Steward reviews"). Compared with
 * each run's record by lib/steward/job-review.ts `reviewRun`; shown in words on the job's page.
 */
export interface JobExpectations {
  /** The usual duration, milliseconds [shortest, longest]; a run past the longest is flagged. */
  durationMs?: readonly [number, number];
  /**
   * What should show work on a scheduled run: summary keys above zero (a Vercel job's answer; an array counts its
   * length) or step names that succeeded (a GitHub job). Any one is enough.
   */
  nonzero?: readonly string[];
  /** A run that did its work should have written a change (a data_change_sets row with its run id). */
  writesChange?: boolean;
  /**
   * When a run that did nothing is right, in a sentence for the console. Without it a scheduled run that did nothing
   * is flagged; a housekeeping or out-of-season firing is always allowed to do nothing.
   */
  nothingOkWhen?: string;
  /**
   * Safe to start again once after a failure (the job is idempotent). Never the college-reported pipeline, which
   * spends money, and never the Steward itself.
   */
  restartable?: boolean;
}

const MIN = 60_000;

/** Months of the weekly run: the admits season (March to May) and the census season (August to November). */
const WEEKLY_SEASONS = [3, 4, 5, 8, 9, 10, 11] as const;
/** Months of the monthly run: the CDS edition months outside the weekly seasons. */
const MONTHLY = [12, 1, 2, 6, 7] as const;
/** The systems season (June and July): a second run on the 15th makes it every two weeks. */
const SYSTEMS_SEASON = [6, 7] as const;

/** The jobs, Vercel's first, then the scheduled workflows, then the workflows run by hand only. */
export const JOBS: readonly JobDef[] = [
  {
    id: "digests",
    name: "Update digest",
    description: "Emails each person who follows a college that changed in a recent publish, once per publish.",
    runner: "vercel",
    path: "/api/cron/digests",
    schedules: [{ cron: "0 13 * * *" }],
    gate: "Does nothing until email sending is configured.",
    spec: "specs/product/follow-colleges.md",
    // One `digests` row per person and publish, written only after a send: a second run sends nothing twice.
    expects: { durationMs: [0, 5 * MIN], nonzero: ["publishes"], nothingOkWhen: "No publish in the last two weeks changed a college anyone follows.", restartable: true },
  },
  {
    id: "visit-alerts",
    name: "Visit alerts",
    description: "Emails followers about visit events first seen or changed in the last day at the colleges they follow.",
    runner: "vercel",
    path: "/api/cron/visit-alerts",
    schedules: [{ cron: "0 13 * * *", note: "After the night's visit-events read." }],
    gate: "Does nothing until email sending is configured.",
    spec: "specs/product/visit-events.md",
    // Nobody gets a second alert within 20 hours (visit_alerts), so a rerun never doubles up.
    expects: { durationMs: [0, 5 * MIN], nonzero: ["events"], nothingOkWhen: "No visit event was new or changed in the last day.", restartable: true },
  },
  {
    id: "interest-confirm",
    name: "Interest confirmations",
    description: "Expires interest acts past their window, then emails each person about the acts still waiting on them.",
    runner: "vercel",
    path: "/api/cron/interest-confirm",
    schedules: [{ cron: "30 13 * * *" }],
    gate: "Does nothing until email sending is configured.",
    spec: "specs/planner/v3/guides/show-interest.md",
    // `emailed_at` is set only after a send and the expiry is a state change, so a rerun repeats nothing.
    expects: { durationMs: [0, 5 * MIN], nothingOkWhen: "No interest act is waiting on anyone.", restartable: true },
  },
  {
    id: "weekly",
    name: "Weekly emails and texts",
    description: "Sunday evening: each student's Your week email and text, the season briefs, each parent's weekly summary, and the season-end snapshot cleanup.",
    runner: "vercel",
    path: "/api/cron/weekly",
    schedules: [{ cron: "0 23 * * 0" }],
    gate: "Does nothing until email or texts are configured.",
    spec: "specs/planner/timeline.md",
    // Not restartable: Your week has no sent-this-week record, so a second run would email every student again.
    expects: { durationMs: [0, 10 * MIN], nonzero: ["students"], restartable: false },
  },
  {
    id: "day-before",
    name: "Day-before texts",
    description: "The evening before a hard deadline (an application, a reply, a deposit), one text to each student with texts on.",
    runner: "vercel",
    path: "/api/cron/day-before",
    schedules: [{ cron: "0 23 * * 1-6", note: "Sunday's evening belongs to the weekly job." }],
    gate: "Does nothing until texts are configured.",
    spec: "specs/planner/timeline.md",
    // At most one text a day per person (lib/planner/reminders-server.ts deliverText), so a rerun sends nothing twice.
    expects: { durationMs: [0, 5 * MIN], nonzero: ["sent"], nothingOkWhen: "No student with texts on has a hard deadline tomorrow.", restartable: true },
  },
  {
    id: "college-reported",
    name: "College-reported data",
    description: "Finds and reads each college's Common Data Set, class profile and announcements of its newest class, writes the values to the data store, and asks the publisher for a snapshot.",
    runner: "github",
    workflow: "college-reported.yml",
    schedules: [
      { cron: "17 13 * * 1", months: WEEKLY_SEASONS, note: "Mondays in the admits (March to May) and census (August to November) seasons." },
      { cron: "17 13 1 * *", months: MONTHLY, note: "The first of the month from December to February and in June and July." },
      { cron: "17 13 15 6,7 *", months: SYSTEMS_SEASON, note: "The 15th of June and July: with the 1st, the systems season every two weeks." },
      { cron: "7,37 * * * *", headline: false, note: "Collects a run's open batches; exits at once when none is open." },
    ],
    spec: "specs/college-reported-data.md",
    dispatch: "college",
    // Never restarted by the Steward: a run spends money (up to $150 on the schedule).
    expects: {
      durationMs: [MIN, 330 * MIN],
      nonzero: ["Run the ingestion pipeline", "Collect the open batches"],
      writesChange: true,
      nothingOkWhen: "No open batch: the half-hourly collect does nothing. A firing out of season stops at once.",
      restartable: false,
    },
  },
  {
    id: "identity-refresh",
    name: "Identity refresh",
    description: "Re-syncs Wikidata social accounts, re-probes each college's site for its links and visit page, and re-reads college colors.",
    runner: "github",
    workflow: "identity-refresh.yml",
    schedules: [{ cron: "0 6 * * *" }],
    gate: "Fires daily; does the refresh only when the last site probe is 28 or more days old.",
    spec: "specs/school-identity/follow-ups.md",
    dispatch: "identity",
    expects: {
      durationMs: [MIN, 90 * MIN],
      nonzero: ["Sync Wikidata", "Probe every college's site", "Sync brand colors"],
      writesChange: true,
      nothingOkWhen: "The last site probe is under 28 days old: the daily firing checks and stops.",
      restartable: true,
    },
  },
  {
    id: "visit-events",
    name: "Visit events",
    description: "Reads every known Slate host's event calendar and records what is new, changed, or gone.",
    runner: "github",
    workflow: "visit-events.yml",
    schedules: [{ cron: "23 6 * * *" }],
    spec: "specs/product/visit-events.md",
    dispatch: "visit-events",
    // Writes the visit-event tables, not the data store, so no change; a reread is idempotent.
    expects: { durationMs: [2 * MIN, 300 * MIN], nonzero: ["Read the calendars", "Check what was read"], writesChange: false, restartable: true },
  },
  {
    id: "publish-snapshot",
    name: "Publish snapshot",
    description: "Composes the data layers into a snapshot, publishes it, writes the tables beside it, and asks Vercel to rebuild. Pipelines also start it when they finish.",
    runner: "github",
    workflow: "publish-snapshot.yml",
    schedules: [{ cron: "0 8 * * *", note: "The nightly catch-up; a held change set stops an automatic run." }],
    spec: "specs/data-platform/publish.md",
    dispatch: "publish-snapshot",
    // Its publish step has no name, and "nothing new" is a normal night: it is judged on failure and time only.
    expects: {
      durationMs: [MIN, 60 * MIN],
      writesChange: false,
      nothingOkWhen: "Nothing changed since the last published version, or a held change stops the nightly run.",
      restartable: true,
    },
  },
  {
    id: "data-steward",
    name: "Data Steward",
    description:
      "Groups the review queue by cause, checks the causes against the colleges' documents, and writes issues and proposals for the console. Runs after each college-reported run that read something ($5), by hand ($20), and weekly for an audit.",
    runner: "github",
    workflow: "steward.yml",
    schedules: [{ cron: "0 9 * * 0", note: "The weekly audit of one check family ($10)." }],
    gate: "After a college-reported run, runs only when that run read or collected something; every run stops at its budget and the week's $40.",
    spec: "specs/product/data-steward.md",
    dispatch: "steward",
    // The Steward doesn't review its own runs (its record and spend are on Steward runs); this is for a review by hand.
    expects: {
      durationMs: [MIN, 90 * MIN],
      nonzero: ["Run the Steward"],
      writesChange: true,
      nothingOkWhen: "After a college-reported run that read and collected nothing, the gate skips the run.",
      restartable: false,
    },
  },
  {
    id: "sync-data",
    name: "Sync data",
    description: "Rebuilds the base dataset from College Scorecard and the IPEDS files.",
    runner: "github",
    workflow: "sync-data.yml",
    schedules: [{ cron: "0 9 * * 1", note: "On the schedule, only the NCES release-calendar check; the full sync is run by hand." }],
    spec: "specs/data-platform/pipelines.md",
    dispatch: "sync-data",
    // The scheduled firing checks the release calendar and writes only when it changed.
    expects: { durationMs: [MIN / 2, 120 * MIN], nonzero: ["Build the base layer"], writesChange: false, restartable: false },
  },
  {
    id: "sync-history",
    name: "Sync history",
    description: "Rebuilds the year-by-year history for every college from the NCES files and College Scorecard.",
    runner: "github",
    workflow: "sync-history.yml",
    schedules: [{ cron: "0 9 3 * *" }],
    spec: "specs/trends-data.md",
    dispatch: "history",
    expects: { durationMs: [5 * MIN, 120 * MIN], nonzero: ["Build the history"], writesChange: true, restartable: false },
  },
  {
    id: "common-app",
    name: "Common App",
    description: "Downloads the Common App requirements grid and member records.",
    runner: "github",
    workflow: "common-app.yml",
    schedules: [],
    spec: "specs/data-expansion/common-app.md",
    dispatch: "common-app",
    expects: { durationMs: [MIN, 60 * MIN], writesChange: true, restartable: false },
  },
  {
    id: "coalition",
    name: "Coalition",
    description: "Reads the Coalition member list and Scoir's list and joins the names.",
    runner: "github",
    workflow: "coalition.yml",
    schedules: [],
    spec: "specs/data-expansion/coalition-app.md",
    dispatch: "coalition",
    expects: { durationMs: [MIN / 2, 20 * MIN], writesChange: true, restartable: false },
  },
  {
    id: "essay-prompts",
    name: "Essay prompts",
    description: "Reads colleges' essay-prompt pages with the model and holds anything that fails its checks for a person.",
    runner: "github",
    workflow: "essay-prompts.yml",
    schedules: [],
    spec: "specs/product/essays/prompts.md",
    // Spends money (a model read per page, up to its budget).
    expects: { durationMs: [MIN, 240 * MIN], writesChange: true, restartable: false },
  },
  {
    id: "eval-reviewer",
    name: "Reviewer eval",
    description: "Runs the essay reader's evaluation set against the live model and keeps the summary as a run artifact.",
    runner: "github",
    workflow: "eval-reviewer.yml",
    schedules: [],
    spec: "specs/product/essays/reviewer.md",
    // Spends money; keeps its summary as an artifact, not a change.
    expects: { durationMs: [MIN, 60 * MIN], writesChange: false, restartable: false },
  },
  {
    id: "campus-pilot",
    name: "Campus-life pilot",
    description: "Reads campus-life pages for a list of colleges under a spend cap.",
    runner: "github",
    workflow: "campus-pilot.yml",
    schedules: [],
    spec: "specs/campus-pilot-accuracy.md",
    // Spends money; its change is held for a person by design.
    expects: { durationMs: [MIN, 150 * MIN], writesChange: true, restartable: false },
  },
  {
    id: "hs-profile-pilot",
    name: "High school profile pilot",
    description: "Extracts course lists from high school profiles for the pilot set.",
    runner: "github",
    workflow: "hs-profile-pilot.yml",
    schedules: [],
    spec: "specs/product/high-school-data.md",
    // Spends money (a model read per profile, up to its cap).
    expects: { durationMs: [MIN, 150 * MIN], writesChange: true, restartable: false },
  },
];

export type JobId = (typeof JOBS)[number]["id"];

/** A job's id is also its URL segment, so only this shape is looked up. */
const JOB_ID = /^[a-z][a-z0-9-]{0,40}$/;

export function jobById(id: string): JobDef | null {
  if (!JOB_ID.test(id)) return null;
  return JOBS.find((j) => j.id === id) ?? null;
}

/** The workflow files of the GitHub jobs (every one, scheduled or not). */
export function githubWorkflows(): string[] {
  return JOBS.filter((j) => j.runner === "github" && j.workflow).map((j) => j.workflow!);
}

export function jobByWorkflow(file: string): JobDef | null {
  return JOBS.find((j) => j.workflow === file) ?? null;
}

/** Whether a schedule fires on a day a job proceeds (its `months`, when it has them). */
function proceeds(s: JobSchedule, at: Date): boolean {
  return !s.months || s.months.includes(at.getUTCMonth() + 1);
}

/** How many firings to look past for one that proceeds (a monthly cron gated to eight months needs at most four). */
const GATED_LOOKAHEAD = 60;

/** The next firing of one schedule after `from` that proceeds; null when it never does. */
export function nextScheduleRun(s: JobSchedule, from: Date): Date | null {
  const parsed = parseCron(s.cron);
  let at = from;
  for (let i = 0; i < GATED_LOOKAHEAD; i++) {
    const next = nextRun(parsed, at);
    if (!next) return null;
    if (proceeds(s, next)) return next;
    at = next;
  }
  return null;
}

/**
 * The job's next run: the earliest next firing among its headline schedules (`headline !== false`) that proceeds.
 * Null for a job run by hand only.
 */
export function nextJobRun(job: JobDef, from: Date): Date | null {
  let best: Date | null = null;
  for (const s of job.schedules) {
    if (s.headline === false) continue;
    const next = nextScheduleRun(s, from);
    if (next && (!best || next < best)) best = next;
  }
  return best;
}

/** How late a scheduled firing may start and still be matched to its cron (GitHub's schedules can run minutes late). */
const FIRING_SLACK_MINUTES = 20;

/**
 * Which of the job's schedules a scheduled run came from, by its start time: the schedule that fired in the
 * `FIRING_SLACK_MINUTES` before it. Null when none did (a run started by hand, or a schedule since changed).
 */
export function scheduleOfRun(job: JobDef, startedAt: Date): JobSchedule | null {
  for (const s of job.schedules) {
    const parsed = parseCron(s.cron);
    // Scan back from the start minute; the first schedule whose firing falls in the window wins.
    const earliest = new Date(startedAt.getTime() - FIRING_SLACK_MINUTES * 60_000);
    const fired = nextRun(parsed, new Date(earliest.getTime() - 60_000));
    if (fired && fired <= startedAt && fired >= earliest) return s;
  }
  return null;
}
