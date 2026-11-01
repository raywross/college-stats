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
  /** The row of lib/admin/workflows.ts `DISPATCHABLE_RUNS` that starts this job from Operations, when there is one. */
  dispatch?: string;
}

const FALL = [8, 9, 10, 11] as const;
const CDS_SEASON = [12, 1, 2, 3, 4, 5, 6, 7] as const;

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
  },
  {
    id: "college-reported",
    name: "College-reported data",
    description: "Finds and reads each college's Common Data Set and class profile, writes the values to the data store, and asks the publisher for a snapshot.",
    runner: "github",
    workflow: "college-reported.yml",
    schedules: [
      { cron: "0 13 * * 1", months: FALL, note: "Mondays in the fall class-profile season (August to November)." },
      { cron: "0 13 1 * *", months: CDS_SEASON, note: "The first of the month in the CDS edition season (December to July)." },
      { cron: "*/30 * * * *", headline: false, note: "Collects a run's open batches; exits at once when none is open." },
    ],
    spec: "specs/college-reported-data.md",
    dispatch: "college",
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
  },
  {
    id: "visit-events",
    name: "Visit events",
    description: "Reads every known Slate host's event calendar and records what is new, changed, or gone.",
    runner: "github",
    workflow: "visit-events.yml",
    schedules: [{ cron: "0 7 * * *" }],
    spec: "specs/product/visit-events.md",
    dispatch: "visit-events",
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
  },
  {
    id: "essay-prompts",
    name: "Essay prompts",
    description: "Reads colleges' essay-prompt pages with the model and holds anything that fails its checks for a person.",
    runner: "github",
    workflow: "essay-prompts.yml",
    schedules: [],
    spec: "specs/product/essays/prompts.md",
  },
  {
    id: "eval-reviewer",
    name: "Reviewer eval",
    description: "Runs the essay reader's evaluation set against the live model and keeps the summary as a run artifact.",
    runner: "github",
    workflow: "eval-reviewer.yml",
    schedules: [],
    spec: "specs/product/essays/reviewer.md",
  },
  {
    id: "campus-pilot",
    name: "Campus-life pilot",
    description: "Reads campus-life pages for a list of colleges under a spend cap.",
    runner: "github",
    workflow: "campus-pilot.yml",
    schedules: [],
    spec: "specs/campus-pilot-accuracy.md",
  },
  {
    id: "hs-profile-pilot",
    name: "High school profile pilot",
    description: "Extracts course lists from high school profiles for the pilot set.",
    runner: "github",
    workflow: "hs-profile-pilot.yml",
    schedules: [],
    spec: "specs/product/high-school-data.md",
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
