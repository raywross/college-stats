/**
 * How the Jobs pages read (specs/product/admin-jobs.md): a job's next run in words, a stored run's outcome and its
 * one-line summary, the trigger's label, and the page URLs. Pure, so tests/jobs.test.mts pins it and the pages hold
 * only layout. Dates are UTC labels from lib/admin/ops-view.ts, the way Operations writes them.
 */
import { runOutcome, type RunTone } from "../admin/ops-view.ts";
import type { JobDef } from "./registry.ts";
import type { RunTrigger, StoredRunStatus } from "./record.ts";

/** A job's last run as the view needs it: a stored row's status, or a GitHub run's status and conclusion. */
export type LastRunLike = { kind: "stored"; run: { status: StoredRunStatus } } | { kind: "github"; run: { status: string; conclusion: string | null } } | null;

/** The five states a job's last run can be in, worst first. */
export const OUTCOME_KEYS = ["failed", "running", "none", "other", "ok"] as const;
export type OutcomeKey = (typeof OUTCOME_KEYS)[number];

export const OUTCOME_LABEL: Readonly<Record<OutcomeKey, string>> = {
  failed: "Failed",
  running: "Running",
  none: "No run recorded",
  other: "Nothing to do",
  ok: "Succeeded",
};

/** A job's last run in one word, its tone, and its place in the worst-first order (0 is worst). */
export function lastOutcome(last: LastRunLike): { key: OutcomeKey; label: string; tone: RunTone } {
  if (!last) return { key: "none", label: OUTCOME_LABEL.none, tone: "other" };
  const o = last.kind === "stored" ? storedOutcome(last.run.status) : runOutcome(last.run);
  const key: OutcomeKey = o.tone === "failed" ? "failed" : o.tone === "running" ? "running" : o.tone === "ok" ? "ok" : "other";
  return { key, label: o.label, tone: o.tone };
}

/** How many jobs' last runs are in each state (every key present, zero when none). */
export function outcomeCounts(rows: readonly { last: LastRunLike }[]): Record<OutcomeKey, number> {
  const counts = Object.fromEntries(OUTCOME_KEYS.map((k) => [k, 0])) as Record<OutcomeKey, number>;
  for (const r of rows) counts[lastOutcome(r.last).key]++;
  return counts;
}

/** The all-jobs view's order: failed last runs first, then running, never run, nothing to do, succeeded; then by name. */
export function sortJobsByOutcome<T extends { job: JobDef; last: LastRunLike }>(rows: readonly T[]): T[] {
  const rank = (r: T) => OUTCOME_KEYS.indexOf(lastOutcome(r.last).key);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.job.name.localeCompare(b.job.name));
}

export const JOBS_VIEWS = ["schedule", "all"] as const;
export type JobsView = (typeof JOBS_VIEWS)[number];

/** `?view=` on the list: `all` for one table of every job, anything else the schedule view. */
export function parseJobsView(raw: string | string[] | undefined): JobsView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "all" ? "all" : "schedule";
}

export function jobsViewHref(view: JobsView): string {
  return view === "all" ? `${JOBS_HREF}?view=all` : JOBS_HREF;
}

export const JOBS_HREF = "/admin/jobs";

export function jobHref(job: Pick<JobDef, "id">): string {
  return `${JOBS_HREF}/${job.id}`;
}

export function runHref(job: Pick<JobDef, "id">, runId: number | string): string {
  return `${jobHref(job)}/runs/${runId}`;
}

export const RUNNER_LABEL: Readonly<Record<JobDef["runner"], string>> = { vercel: "Vercel Cron", github: "GitHub Actions" };

export const TRIGGER_LABEL: Readonly<Record<RunTrigger, string>> = { schedule: "Schedule", manual: "By hand" };

/** A stored run's state in words and a tone, matching Operations' RunChip. */
export function storedOutcome(status: StoredRunStatus): { label: string; tone: RunTone } {
  switch (status) {
    case "running":
      return { label: "Running", tone: "running" };
    case "ok":
      return { label: "Succeeded", tone: "ok" };
    case "failed":
      return { label: "Failed", tone: "failed" };
    case "skipped":
      return { label: "Nothing to do", tone: "other" };
  }
}

/** "in 3 h", "in 2 days", "4 min ago", "yesterday"; "now" inside a minute. */
export function relativeLabel(at: Date, now: Date): string {
  const diffMs = at.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;
  const wrap = (s: string) => (future ? `in ${s}` : `${s} ago`);
  const min = Math.round(abs / 60_000);
  if (min < 1) return "now";
  if (min < 60) return wrap(`${min} min`);
  const h = Math.round(abs / 3_600_000);
  if (h < 24) return wrap(`${h} h`);
  const days = Math.round(abs / 86_400_000);
  if (days === 1) return future ? "tomorrow" : "yesterday";
  if (days < 60) return wrap(`${days} days`);
  const months = Math.round(days / 30);
  return wrap(`${months} month${months === 1 ? "" : "s"}`);
}

/** How many of a summary's counts the one-line form shows. */
const SUMMARY_LINE_MAX = 6;

/**
 * A run's summary in one line: its top-level counts ("sent 3 · errors 1"), an array by its length ("publishes 2"),
 * nothing for booleans, strings, or nested objects. Empty when there is nothing countable.
 */
export function summaryLine(summary: Record<string, unknown> | null | undefined): string {
  if (!summary) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (parts.length >= SUMMARY_LINE_MAX) break;
    if (key === "configured" || key === "error") continue;
    if (typeof value === "number" && Number.isFinite(value)) parts.push(`${key.replace(/_/g, " ")} ${value.toLocaleString("en-US")}`);
    else if (Array.isArray(value)) parts.push(`${key.replace(/_/g, " ")} ${value.length.toLocaleString("en-US")}`);
  }
  return parts.join(" · ");
}

/** Which jobs the list shows first: the scheduled ones by next run, then the hand-run ones by name. */
export function sortJobs<T extends { job: JobDef; next: Date | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.next && b.next) return a.next.getTime() - b.next.getTime() || a.job.name.localeCompare(b.job.name);
    if (a.next) return -1;
    if (b.next) return 1;
    return a.job.name.localeCompare(b.job.name);
  });
}

/** A run id in a URL: GitHub's run ids and `job_runs` ids are both positive integers. */
export function parseRunId(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}
