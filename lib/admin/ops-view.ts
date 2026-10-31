/**
 * How the Operations page and the Health table read: dates, durations, who started a run, the review queue's filters
 * and page, and the plain-words labels for checks and flags. Pure (type-only imports of the client modules), so
 * `tests/admin-ops.test.mts` pins it and the pages hold only layout. Dates are UTC, written the way the console writes
 * them everywhere ("Oct 4, 2026"); nothing here names a data year.
 */
import type { ChecksState, DataPull, WorkflowRun } from "../github-app.ts";
import type { QueueRow, QueueStatus } from "./review-queue.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Oct 4, 2026" for an ISO date or timestamp; a dash for none or nonsense. */
export function dayLabel(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "—";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : "—";
}

/** "Oct 4, 14:02 UTC" for a timestamp. */
export function timeLabel(iso: string | null | undefined): string {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(iso ?? "");
  return m ? `${dayLabel(iso).replace(/, \d{4}$/, "")}, ${m[1]}:${m[2]} UTC` : dayLabel(iso);
}

/** "2 h 5 min", "14 min", "42 s"; a dash when the run hasn't finished. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** "$142.50" for a dollar amount. */
export function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Who or what started a run: the schedule; the console and which admin (`consoleAdmin` is that admin's display name,
 * looked up from the log by the run's request id); or GitHub, by hand, naming the GitHub account.
 */
export function startedBy(run: Pick<WorkflowRun, "event" | "requestId" | "actor">, consoleAdmin: string | null): string {
  if (run.event === "schedule") return "Schedule";
  if (run.event === "workflow_dispatch") {
    if (run.requestId) return consoleAdmin ? `Console, ${consoleAdmin}` : "Console";
    return run.actor ? `GitHub, ${run.actor}` : "GitHub, by hand";
  }
  if (run.event === "pull_request" || run.event === "push") return run.actor ? `GitHub, ${run.actor}` : "GitHub";
  return run.event || "—";
}

export type RunTone = "running" | "ok" | "failed" | "other";

/** A run's state in words: still going, how it finished, or why it didn't run. */
export function runOutcome(run: Pick<WorkflowRun, "status" | "conclusion">): { label: string; tone: RunTone } {
  if (run.status !== "completed") return { label: run.status === "queued" ? "Queued" : "Running", tone: "running" };
  switch (run.conclusion) {
    case "success":
      return { label: "Succeeded", tone: "ok" };
    case "failure":
      return { label: "Failed", tone: "failed" };
    case "timed_out":
      return { label: "Timed out", tone: "failed" };
    case "cancelled":
      return { label: "Cancelled", tone: "other" };
    case "skipped":
      return { label: "Skipped", tone: "other" };
    default:
      return { label: run.conclusion ? run.conclusion.replace(/_/g, " ") : "Finished", tone: "other" };
  }
}

/** Whether a finished run failed in a way that has a failed step worth naming. */
export function runFailed(run: Pick<WorkflowRun, "status" | "conclusion">): boolean {
  return run.status === "completed" && (run.conclusion === "failure" || run.conclusion === "timed_out");
}

export const CHECKS_LABELS: Readonly<Record<ChecksState, string>> = {
  success: "Checks passed",
  pending: "Checks running",
  failure: "Checks failed",
  none: "Checks not started",
};

/** Whether Approve and merge can succeed now, and the reason it can't (the merge itself refuses the same cases). */
export function mergeBlock(pull: Pick<DataPull, "draft" | "checks">): string | null {
  if (pull.draft) return "A draft: it is still collecting batches. Finish open batches first.";
  if (pull.checks === "pending") return "Checks are still running.";
  if (pull.checks === "none") return "Checks have not started. Re-run CI starts them.";
  if (pull.checks === "failure") return "Checks failed.";
  return null;
}

/* ------------------------------------------------------------------ */
/* The review queue                                                    */
/* ------------------------------------------------------------------ */

export const QUEUE_PAGE_SIZE = 25;
export const QUEUE_STATUSES = ["open", "accepted", "rejected", "all"] as const;
export type QueueStatusFilter = (typeof QUEUE_STATUSES)[number];

export interface OperationsParams {
  /** A six-digit unit id: prefills the college run and narrows the queue to that college. */
  unit: string | null;
  queueStatus: QueueStatusFilter;
  /** A template code, "C.116". */
  code: string | null;
  /** Part of a college's name. */
  college: string | null;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string | null {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
}

/** The Operations URL's query, validated; unknown values are dropped. */
export function parseOperationsParams(params: Params): OperationsParams {
  const unit = one(params, "unit");
  const status = one(params, "qstatus");
  const code = one(params, "code");
  const college = one(params, "college");
  const page = Number(one(params, "qpage"));
  return {
    unit: unit && /^\d{6}$/.test(unit) ? unit : null,
    queueStatus: (QUEUE_STATUSES as readonly string[]).includes(status ?? "") ? (status as QueueStatusFilter) : "open",
    code: code && /^[A-Za-z0-9.]{1,12}$/.test(code) ? code.toUpperCase() : null,
    college: college ? college.slice(0, 60) : null,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The query string for the Operations page (no leading "?"), defaults left out. */
export function operationsQuery(p: Partial<OperationsParams>): string {
  const q = new URLSearchParams();
  if (p.unit) q.set("unit", p.unit);
  if (p.queueStatus && p.queueStatus !== "open") q.set("qstatus", p.queueStatus);
  if (p.code) q.set("code", p.code);
  if (p.college) q.set("college", p.college);
  if (p.page && p.page > 1) q.set("qpage", String(p.page));
  return q.toString();
}

/** Queue rows that pass the filters (the unit narrows too: "this college's items"), in the order given. */
export function filterQueueRows(rows: readonly QueueRow[], p: Pick<OperationsParams, "unit" | "queueStatus" | "code" | "college">): QueueRow[] {
  const name = p.college?.toLowerCase();
  return rows.filter((r) => {
    if (p.queueStatus !== "all" && r.status !== (p.queueStatus as QueueStatus)) return false;
    if (p.unit && r.item.unit_id !== p.unit) return false;
    if (p.code && (r.item.code ?? "C1").toUpperCase() !== p.code) return false;
    if (name && !r.item.name.toLowerCase().includes(name) && r.item.unit_id !== name) return false;
    return true;
  });
}

/** The template codes present in the rows, in code order ("C1" for the whole-extraction entries): the code filter's options. */
export function queueCodes(rows: readonly QueueRow[]): string[] {
  return [...new Set(rows.map((r) => r.item.code ?? "C1"))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** The edition (or the class a round-1/2 entry describes) a queue item came from. */
export function itemEdition(item: QueueRow["item"]): string {
  return item.edition ?? item.entering_term ?? "—";
}

/** The value read: a per-item entry's value, or a round-1/2 entry's applicants/admitted/enrolled. */
export function itemValue(item: QueueRow["item"]): string {
  if (item.code) return item.value === null || item.value === undefined ? "—" : String(item.value);
  const x = item.extraction;
  if (!x) return "—";
  const part = (label: string, v: unknown) => (typeof v === "number" ? `${label} ${v.toLocaleString("en-US")}` : null);
  return [part("applied", x.applicants), part("admitted", x.admitted), part("enrolled", x.enrolled)].filter(Boolean).join(", ") || "—";
}

/** The document's host and file name, for a link label: "uah.edu / university_of_alabama_cds.pdf". */
export function documentLabel(url: string | undefined): string {
  if (!url) return "No document";
  try {
    const u = new URL(url);
    const file = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return file ? `${u.hostname.replace(/^www\./, "")} / ${file}` : u.hostname;
  } catch {
    return url.slice(0, 60);
  }
}

/** Only http(s) links are rendered as links. */
export function safeHref(url: string | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
