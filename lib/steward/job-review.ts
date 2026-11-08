/**
 * The Steward's job review (specs/product/admin-redesign.md "What the Steward reviews"): one run's record compared with
 * its job's expectations (lib/jobs/registry.ts `JobExpectations`), giving a verdict, the reasons in sentences, and the
 * one repair the fixed tools may make. Pure: scripts/steward.mts's `review` mode reads the run (a `job_runs` row, or a
 * workflow run with its steps and the changes it wrote) into a `RunView`, calls `reviewRun`, and writes the result;
 * the console shows it. tests/steward-job-review.test.mts runs it on recorded runs.
 *
 * Rules, in order:
 * - A run that failed is `failed`; one cancelled, or still running when reviewed, is `flagged`.
 * - A run longer than its usual longest is `flagged`.
 * - A scheduled run that did no work (no `nonzero` summary key above zero, no `nonzero` step that succeeded) is
 *   `flagged`, unless nothing is right for this firing: a housekeeping firing (the half-hourly collect), a firing out of
 *   its season, or, for a job without either kind of firing, a job whose `nothingOkWhen` says when nothing is right.
 *   A run started by hand or by another workflow isn't held to `nonzero`.
 * - A headline run that did its work but wrote no change, when `writesChange` says it should, is `flagged`.
 * - A held change in what the run wrote is `flagged`, with the repair `hold-finding`.
 * Repairs, the first that applies: `hold-finding` (a change the run wrote is held: a finding on it, so it reaches the
 * Inbox); `restart` (a failed run of a `restartable` job with no restart of the job in the last 24 hours); `publish`
 * (a change was applied and no publish followed: the run's own "Ask … for a snapshot" step didn't succeed, or two
 * hours passed with no publish).
 */
import type { JobDef } from "../jobs/registry.ts";
import { scheduleOfRun } from "../jobs/registry.ts";
import type { JobsWeek, ReviewDoc, ReviewRepair, ReviewVerdict, RunDoc } from "./types.ts";

/** How a run ended, in the review's words (a Vercel row's status; a workflow run's conclusion mapped by `githubStatus`). */
export type RunViewStatus = "ok" | "failed" | "skipped" | "running" | "cancelled";

/** A step of a workflow run (flattened across its jobs). */
export interface RunStepView {
  /** The workflow job's name ("run", "collect"), when known. */
  job?: string;
  name: string;
  /** GitHub's conclusion: success, failure, skipped, cancelled, or null while running. */
  conclusion: string | null;
}

/** A change the run wrote (`data_change_sets` with `run_ref` = the run id). */
export interface RunChangeSetView {
  id: number;
  source: string;
  status: string;
  held_reason?: string | null;
}

/** One run as the review reads it, whichever runner recorded it. */
export interface RunView {
  /** The run's id: a `job_runs` id or a workflow run id. */
  ref: string;
  /** `schedule` when its schedule fired it; `manual` (a person, the console, the Steward), or `pipeline` (another workflow). */
  trigger: "schedule" | "manual" | "pipeline";
  status: RunViewStatus;
  startedAt: string;
  finishedAt: string | null;
  /** A Vercel job's answer (its counts). */
  summary?: Record<string, unknown>;
  /** A workflow run's steps. */
  steps?: readonly RunStepView[];
  /** The changes it wrote; undefined when they weren't read. */
  changeSets?: readonly RunChangeSetView[];
  error?: string | null;
  /** Where a person reads the run (GitHub's page), when there is one. */
  url?: string | null;
}

export interface JobReview {
  verdict: ReviewVerdict;
  reasons: string[];
  repair: ReviewRepair | null;
}

/** What the review needs beyond the run itself. */
export interface ReviewContext {
  /** The review's clock (the two-hour publish window); the run's finish when absent. */
  now?: Date;
  /** When the Steward last restarted this job (a review with `repair: "restart"` carried out), or null. */
  lastRestartAt?: string | null;
  /** When the first publish after the run's finish happened: an ISO time, null for none yet, undefined when unknown. */
  publishAfter?: string | null;
}

/** A restart of the same job at most once in this window. */
export const RESTART_WINDOW_MS = 24 * 3_600_000;
/** A change applied with no publish after this long gets the publish repair. */
export const PUBLISH_WINDOW_MS = 2 * 3_600_000;
/** The publisher's own job id: it is never asked to publish after itself. */
export const PUBLISHER_JOB = "publish-snapshot";
/** The step a pipeline ends with to ask the publisher for a version. */
export const PUBLISH_STEP = /^Ask (the publisher )?for a snapshot$/;

/** The review document's key: one per job and run. */
export function reviewKey(job: string, ref: string): string {
  return `${job}:${ref}`;
}

/** A workflow run's conclusion in the review's words. */
export function githubStatus(status: string, conclusion: string | null): RunViewStatus {
  if (status !== "completed") return "running";
  switch (conclusion) {
    case "success":
      return "ok";
    case "skipped":
    case "neutral":
      return "skipped";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

/** A workflow run's event as the review's trigger. */
export function githubTrigger(event: string): RunView["trigger"] {
  if (event === "schedule") return "schedule";
  if (event === "repository_dispatch" || event === "workflow_run") return "pipeline";
  return "manual";
}

const minutes = (ms: number) => {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m ? `${h} h ${m} min` : `${h} h`;
};

/** A summary value as a count: a number, an array's length, a boolean as 0 or 1; anything else 0. */
export function countOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "boolean") return value ? 1 : 0;
  return 0;
}

/** Whether the run shows work by its job's `nonzero` keys or steps; null when the job names none. */
export function didWork(job: JobDef, run: RunView): boolean | null {
  const keys = job.expects?.nonzero ?? [];
  if (!keys.length) return null;
  if (job.runner === "vercel") return keys.some((k) => countOf(run.summary?.[k]) > 0);
  return keys.some((name) => (run.steps ?? []).some((s) => s.name === name && s.conclusion === "success"));
}

/** Which kind of firing a scheduled run was: housekeeping, out of season, a headline one, or unknown (no schedule matched). */
export function firingOf(job: JobDef, run: RunView): "housekeeping" | "off-season" | "headline" | "unknown" {
  if (run.trigger !== "schedule") return "unknown";
  const started = new Date(run.startedAt);
  const s = scheduleOfRun(job, started);
  if (!s) return "unknown";
  if (s.headline === false) return "housekeeping";
  if (s.months && !s.months.includes(started.getUTCMonth() + 1)) return "off-season";
  return "headline";
}

/** Whether the job has firings that are allowed to do nothing by their shape (housekeeping or seasonal ones). */
function hasShapedFirings(job: JobDef): boolean {
  return job.schedules.some((s) => s.headline === false || !!s.months);
}

/** Why doing nothing is right for this run, or null when it isn't. */
function nothingIsRight(job: JobDef, firing: ReturnType<typeof firingOf>): string | null {
  const ok = job.expects?.nothingOkWhen ?? null;
  if (firing === "housekeeping") return ok ?? "A housekeeping firing: it usually has nothing to do.";
  if (firing === "off-season") return "A firing out of season: it stops at once by design.";
  // A headline firing of a job that has housekeeping or seasonal ones is the one that should work. A firing no
  // schedule matched (GitHub ran it more than twenty minutes late) gets the benefit of the doubt.
  if (firing === "headline" && hasShapedFirings(job)) return null;
  return ok;
}

const failedSteps = (run: RunView) => (run.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => (s.job ? `${s.job} › ${s.name}` : s.name));

/** Compares one run's record with its job's expectations. */
export function reviewRun(job: JobDef, run: RunView, ctx: ReviewContext = {}): JobReview {
  const expects = job.expects ?? {};
  const reasons: string[] = [];
  let verdict: ReviewVerdict = "fine";
  const flag = (why: string) => {
    reasons.push(why);
    if (verdict === "fine") verdict = "flagged";
  };
  const firing = firingOf(job, run);

  // How it ended.
  if (run.status === "failed") {
    verdict = "failed";
    const steps = failedSteps(run);
    const error = run.error?.trim();
    reasons.push(`It failed${steps.length ? ` at ${steps.join("; ")}` : ""}${error ? `: ${error.slice(0, 300)}` : "."}`);
  } else if (run.status === "cancelled") {
    flag("It was cancelled before it finished.");
  } else if (run.status === "running") {
    flag("It was still running when the Steward looked.");
  } else if (run.status === "skipped") {
    reasons.push(job.gate ?? "It had nothing it could do (not configured).");
  }

  // How long it took.
  const ms = run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null;
  if (ms !== null && Number.isFinite(ms) && expects.durationMs && ms > expects.durationMs[1]) {
    flag(`It took ${minutes(ms)}, longer than its usual ${minutes(expects.durationMs[1])} at most.`);
  }

  // Whether it did its work, on a scheduled run that ended well.
  const worked = didWork(job, run);
  let idle = false;
  if (run.status === "ok" && run.trigger === "schedule" && worked === false) {
    idle = true;
    const right = nothingIsRight(job, firing);
    const what = job.runner === "vercel" ? `its counts (${(expects.nonzero ?? []).join(", ")}) were all zero` : `none of its work steps ran (${(expects.nonzero ?? []).join("; ")})`;
    if (right) reasons.push(`It did nothing, which is right here: ${right}`);
    else flag(`It did nothing on a scheduled run: ${what}.`);
  }

  // Whether it wrote the change it should have (a headline run that worked; housekeeping firings write into the run's own change).
  const changes = run.changeSets;
  if (run.status === "ok" && expects.writesChange && !idle && firing !== "housekeeping" && changes !== undefined && changes.length === 0 && worked !== false) {
    flag("It wrote no change, though a run that does its work writes one.");
  }

  // A held change.
  const held = (changes ?? []).filter((c) => c.status === "held");
  for (const c of held) flag(`Change #${c.id} is held${c.held_reason?.trim() ? `: ${c.held_reason.trim().slice(0, 200)}` : "."} A held change stops every publish.`);

  // The repair.
  let repair: ReviewRepair | null = null;
  const now = ctx.now ?? (run.finishedAt ? new Date(run.finishedAt) : new Date(run.startedAt));
  if (held.length) {
    repair = "hold-finding";
  } else if (run.status === "failed") {
    if (expects.restartable) {
      const last = ctx.lastRestartAt ? Date.parse(ctx.lastRestartAt) : NaN;
      if (Number.isFinite(last) && now.getTime() - last < RESTART_WINDOW_MS) reasons.push("The Steward already started it again once in the last 24 hours, so this one is left to a person.");
      else repair = "restart";
    } else {
      reasons.push("It isn't safe to start again on its own, so this one is left to a person.");
    }
  } else if (job.id !== PUBLISHER_JOB && run.finishedAt) {
    const applied = (changes ?? []).some((c) => c.status === "applied");
    if (applied) {
      const ask = (run.steps ?? []).filter((s) => PUBLISH_STEP.test(s.name));
      const askedOk = ask.some((s) => s.conclusion === "success");
      const waited = now.getTime() - Date.parse(run.finishedAt) >= PUBLISH_WINDOW_MS;
      if ((ask.length > 0 && !askedOk && ctx.publishAfter == null) || (ctx.publishAfter === null && waited)) {
        flag("It wrote a change and no publish followed, so the site doesn't show it yet.");
        repair = "publish";
      }
    }
  }

  if (verdict === "fine" && reasons.length === 0) reasons.push("It ran as expected.");
  return { verdict, reasons, repair };
}

/* ------------------------------------------------------------------ */
/* Words for the console                                               */
/* ------------------------------------------------------------------ */

export const VERDICT_LABEL: Readonly<Record<ReviewVerdict, string>> = { fine: "Looked fine", flagged: "Flagged", failed: "Failed" };
export const REPAIR_LABEL: Readonly<Record<ReviewRepair, string>> = {
  restart: "Started it again",
  publish: "Asked the publisher for a version",
  "hold-finding": "Left a finding on the held change",
};

/** The repair line for a review: what was done, or what was wanted and not done. */
export function repairLine(r: Pick<ReviewDoc, "repair" | "repaired">): string | null {
  if (!r.repair) return null;
  return r.repaired ? REPAIR_LABEL[r.repair] : `Wanted to: ${REPAIR_LABEL[r.repair].toLowerCase()} (not done)`;
}

/** A job's expectations in sentences, for its page. */
export function expectationLines(job: JobDef): string[] {
  const e = job.expects;
  if (!e) return ["No expectations written yet: the Steward reads only whether a run failed."];
  const out: string[] = [];
  if (e.durationMs) out.push(`Usually takes ${minutes(e.durationMs[0])} to ${minutes(e.durationMs[1])}; longer is flagged.`);
  if (e.nonzero?.length) out.push(job.runner === "vercel" ? `A scheduled run should count something in: ${e.nonzero.join(", ")}.` : `A scheduled run should get through: ${e.nonzero.join("; ")}.`);
  if (e.writesChange) out.push("A run that does its work writes a change to the data store.");
  if (e.nothingOkWhen) out.push(`Doing nothing is right when: ${e.nothingOkWhen}`);
  out.push(e.restartable ? "Safe to start again: after a failure the Steward starts it once more, at most once a day." : "Not started again by the Steward: a failure is left to a person.");
  return out;
}

/* ------------------------------------------------------------------ */
/* The weekly jobs summary                                             */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;

/** The week of reviews and Steward runs before `now`, for the Sunday audit's `jobs` summary. */
export function jobsWeek(reviews: readonly ReviewDoc[], runs: readonly RunDoc[], now: Date, queue: { open: number | null; before: number | null } = { open: null, before: null }): JobsWeek {
  const since = now.getTime() - 7 * DAY;
  const inWeek = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) && t >= since && t <= now.getTime();
  };
  const week = reviews.filter((r) => inWeek(r.run_started ?? r.created));
  const byJob = new Map<string, JobsWeek["byJob"][number]>();
  for (const r of week) {
    const row = byJob.get(r.job) ?? { job: r.job, fine: 0, flagged: 0, failed: 0, repaired: 0 };
    row[r.verdict]++;
    if (r.repaired) row.repaired++;
    byJob.set(r.job, row);
  }
  const spendByMode: Record<string, number> = {};
  for (const r of runs) {
    if (!inWeek(r.started)) continue;
    spendByMode[r.mode] = Math.round(((spendByMode[r.mode] ?? 0) + (Number(r.spent_usd) || 0)) * 10_000) / 10_000;
  }
  return {
    from: new Date(since).toISOString(),
    to: now.toISOString(),
    reviewed: week.length,
    failed: week.filter((r) => r.verdict === "failed").length,
    flagged: week.filter((r) => r.verdict === "flagged").length,
    repaired: week.filter((r) => r.repaired).length,
    byJob: [...byJob.values()].sort((a, b) => b.failed - a.failed || b.flagged - a.flagged || a.job.localeCompare(b.job)),
    spendByMode,
    queueOpen: queue.open,
    queueOpenBefore: queue.before,
  };
}
