/**
 * How the Jobs pages read (specs/product/admin-jobs.md): a job's next run in words, a stored run's outcome and its
 * one-line summary, the trigger's label, and the page URLs. Pure, so tests/jobs.test.mts pins it and the pages hold
 * only layout. Dates are UTC labels from lib/admin/ops-view.ts, the way Operations writes them.
 */
import type { RunTone } from "../admin/ops-view.ts";
import type { JobDef } from "./registry.ts";
import type { RunTrigger, StoredRunStatus } from "./record.ts";

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
