/**
 * The Steward's Inbox at /admin (specs/product/admin-redesign.md "The home: Steward › Inbox"): **Needs you**, what waits
 * on a person in order of consequence, and **How things are**, six tiles. Pure over `InboxInput`, the reads the page
 * (and, for the tab bar's count, the layout) makes from what exists today: the Steward's documents, each job's last run,
 * accounts being deleted, invitations nobody accepted, held changes, the last publish, the review queue, data health.
 * tests/admin-inbox.test.mts runs it over fixtures. A read that failed is passed as null and its rows or tile are left
 * out (a tile says "Couldn't read"), never an error on the home page.
 */
import { deletingLabel, fmtDate, fmtDateTime } from "./console.ts";
import type { HelpKey } from "./help.ts";
import { TODO_WHY_LABEL, proposalHref, reviewHref } from "./steward-view.ts";
import { stewardText } from "./words.ts";
import { DELETE_GRACE_DAYS } from "../household-rules.ts";
import type { DecisionDoc, ProposalDoc, RunDoc, TodoDoc } from "../steward/types.ts";
import type { JobOverviewRow } from "../jobs/runs.ts";
import { lastOutcome } from "../jobs/view.ts";

export interface InboxItem {
  kind: "decision" | "proposal" | "todo" | "job" | "deletion" | "invitation" | "held-change";
  title: string;
  why: string;
  href: string;
  action: string;
  /** 1 is the most consequential (stops a publish, a failed job), 3 the least. */
  severity: 1 | 2 | 3;
  /** When it started waiting (ISO), for the age order; null sorts last. */
  at: string | null;
  /** The Steward's sentences as it wrote them, when `stewardText` changed them (the page's `title`). */
  raw?: string;
}

/** A row's title and why in words (`stewardText`), keeping the sentences as written in `raw` when they differ. */
function stewardLines(title: string, why: string): Pick<InboxItem, "title" | "why" | "raw"> {
  const [t, w] = [stewardText(title), stewardText(why)];
  return t === title && w === why ? { title, why } : { title: t, why: w, raw: `${title} — ${why}` };
}

export interface InboxTile {
  label: string;
  value: string;
  note?: string;
  href: string;
  help: HelpKey;
}

/** A job's last run as the Inbox reads it (the page maps lib/jobs/runs.ts's overview to this). */
export interface InboxJob {
  id: string;
  name: string;
  /** lib/jobs/view.ts `lastOutcome` keys, plus "flagged" for a Steward review that flagged the run (U5). */
  outcome: "failed" | "flagged" | "running" | "none" | "other" | "ok";
  /** When the last run started (ISO), or null when it never ran. */
  at: string | null;
  /** One sentence about the run (the Steward's note, or the run's error), when there is one. */
  note?: string | null;
}

export interface InboxDeletion {
  id: string;
  name: string | null;
  deletedAt: string;
}

export interface InboxInvitation {
  id: string;
  householdId: string;
  email: string;
  created: string;
}

export interface InboxHeldChange {
  id: number;
  kind: string;
  source: string;
  held_reason: string | null;
  created_at: string;
}

export interface InboxCounts {
  people: number;
  households: number;
  organizations: number | null;
}

export interface InboxInput {
  now: Date;
  decisions: readonly DecisionDoc[] | null;
  proposals: readonly ProposalDoc[] | null;
  todo: readonly TodoDoc[] | null;
  jobs: readonly InboxJob[] | null;
  deletions: readonly InboxDeletion[] | null;
  invitations: readonly InboxInvitation[] | null;
  heldChanges: readonly InboxHeldChange[] | null;
  /** The Steward's runs, newest first (steward.runs). */
  runs: readonly RunDoc[] | null;
  counts: InboxCounts | null;
  lastPublished: { id: number; created_at: string; colleges: number | null } | null | undefined;
  /** The review queue: open items, and how many of them were queued in the last 7 days. */
  queue: { open: number; newThisWeek: number } | null;
  /** Colleges by overall data health. */
  health: { fresh: number; watch: number; stale: number; failing: number } | null;
}

/**
 * A job overview row as the Inbox reads it. When the Steward reviewed the last run, its verdict decides (a run that
 * ended well but was flagged is `flagged`; failed stays failed) and its note is the row's sentence; otherwise the run's
 * own outcome, as before any review.
 */
export function inboxJob(row: JobOverviewRow): InboxJob {
  const outcome = lastOutcome(row.last).key;
  const at = row.last === null ? null : row.last.kind === "stored" ? row.last.run.startedAt : (row.last.run.startedAt ?? row.last.run.createdAt);
  const reviewed = row.review?.ofLastRun ? row.review.review : null;
  if (reviewed) {
    const verdict = reviewed.verdict === "failed" ? "failed" : reviewed.verdict === "flagged" ? "flagged" : outcome === "failed" ? "failed" : outcome;
    const note = verdict === "ok" || verdict === "other" || verdict === "running" || verdict === "none" ? null : (reviewed.note ?? reviewed.reasons[0] ?? null);
    return { id: row.job.id, name: row.job.name, outcome: verdict, at, note };
  }
  const note = row.last?.kind === "stored" && outcome === "failed" ? row.last.run.error : null;
  return { id: row.job.id, name: row.job.name, outcome, at, note };
}

/** How many To do rows Needs you lists (the highest reach); the rest are one click away on To do. */
export const INBOX_TODO_LIMIT = 5;
/** An invitation waiting longer than this many days is listed. */
export const INVITATION_WAIT_DAYS = 7;
/** The Steward's weekly budget in US dollars (scripts/lib/steward/budget.mts `WEEKLY_CAP_USD`; a test checks they agree). */
export const STEWARD_WEEKLY_CAP_USD = 40;

const DAY = 86_400_000;

/** The id a decision's panel carries on the Decisions page, so the Inbox can open it there. */
export function decisionAnchor(key: string): string {
  return `decision-${key.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * Severity first, then the oldest; To do rows come after the rest of their severity in the order given (highest
 * reach first, as readTodo returns them), so a long-ignored small row never jumps a document many colleges need.
 */
function inboxOrder(x: { item: InboxItem; order: number }, y: { item: InboxItem; order: number }): number {
  const [a, b] = [x.item, y.item];
  if (a.severity !== b.severity) return a.severity - b.severity;
  const todo = Number(a.kind === "todo") - Number(b.kind === "todo");
  if (todo !== 0) return todo;
  if (a.kind === "todo") return x.order - y.order;
  if (a.at === b.at) return a.title.localeCompare(b.title);
  if (a.at === null) return 1;
  if (b.at === null) return -1;
  return a.at.localeCompare(b.at);
}

/**
 * What needs a person, the most consequential first (severity), then the oldest. Held changes and failed jobs stop
 * the site's data from moving (severity 1); decisions, systemic proposals, flagged jobs, and accounts being deleted
 * wait on an answer (2); value proposals, invitations, and To do rows are chores (3).
 */
export function needsYou(input: InboxInput): InboxItem[] {
  const items: InboxItem[] = [];
  const now = input.now.getTime();

  for (const h of input.heldChanges ?? []) {
    items.push({
      kind: "held-change",
      title: `Change #${h.id} is held`,
      why: `${h.held_reason?.trim() || "No reason recorded."} A held change stops every publish.`,
      href: `/admin/data/changes/${h.id}`,
      action: "Review",
      severity: 1,
      at: h.created_at,
    });
  }

  for (const j of input.jobs ?? []) {
    if (j.outcome !== "failed" && j.outcome !== "flagged") continue;
    const when = j.at ? ` (${fmtDateTime(j.at)})` : "";
    items.push({
      kind: "job",
      ...stewardLines(
        j.outcome === "failed" ? `${j.name}: the last run failed` : `${j.name}: the Steward flagged the last run`,
        j.note?.trim() || (j.outcome === "failed" ? `Its last run${when} ended in failure.` : `Its last run${when} looked wrong to the Steward.`),
      ),
      href: `/admin/steward/jobs/${j.id}`,
      action: "Open",
      severity: j.outcome === "failed" ? 1 : 2,
      at: j.at,
    });
  }

  for (const d of input.decisions ?? []) {
    if (d.answer !== null) continue;
    items.push({
      kind: "decision",
      ...stewardLines(d.question, `The Steward recommends: ${d.recommends}`),
      href: `/admin/steward/decisions#${decisionAnchor(d.key)}`,
      action: "Decide",
      severity: 2,
      at: d.created,
    });
  }

  const open = (input.proposals ?? []).filter((p) => p.status === "open");
  // Systemic first: they change every college at once.
  for (const p of [...open].sort((a, b) => Number(b.kind === "systemic") - Number(a.kind === "systemic"))) {
    const rows = p.rows.length;
    items.push({
      kind: "proposal",
      ...stewardLines(p.summary, p.kind === "systemic" ? "Changes how every college is read; the Steward sampled what it would publish." : `${plural(rows, "row")} the Steward wants to change, each with its document.`),
      href: proposalHref(p.key),
      action: "Review",
      severity: p.kind === "systemic" ? 2 : 3,
      at: p.created,
    });
  }

  for (const d of input.deletions ?? []) {
    const purge = new Date(new Date(d.deletedAt).getTime() + DELETE_GRACE_DAYS * DAY).toISOString();
    if (new Date(purge).getTime() < now) continue;
    items.push({
      kind: "deletion",
      title: `${d.name?.trim() || "An account"} is being deleted`,
      why: `${deletingLabel(purge, input.now)}, on ${fmtDate(purge)}. Restore it before then if it was a mistake.`,
      href: `/admin/people/${d.id}`,
      action: "Open",
      severity: 2,
      at: d.deletedAt,
    });
  }

  const todo = (input.todo ?? []).filter((t) => t.status === "open").slice(0, INBOX_TODO_LIMIT);
  for (const t of todo) {
    items.push({
      kind: "todo",
      title: t.subject,
      why: `Only a person can fetch it: ${TODO_WHY_LABEL[t.why] ?? "not recorded"}. Covers ${plural(t.reach, "college")}.`,
      href: t.unit_id ? reviewHref(t.unit_id) : "/admin/steward/todo",
      action: "Open",
      severity: 3,
      at: t.updated,
    });
  }

  for (const i of input.invitations ?? []) {
    const days = Math.floor((now - new Date(i.created).getTime()) / DAY);
    if (days < INVITATION_WAIT_DAYS) continue;
    items.push({
      kind: "invitation",
      title: `Invitation to ${i.email} is still waiting`,
      why: `Sent ${fmtDate(i.created)}, ${plural(days, "day")} ago, and not accepted. It holds a seat in the household.`,
      href: `/admin/households/${i.householdId}`,
      action: "Open",
      severity: 3,
      at: i.created,
    });
  }

  return items
    .map((item, order) => ({ item, order }))
    .sort(inboxOrder)
    .map(({ item }) => item);
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Dollars the Steward spent in the seven days before `now` (the same window its budget guard uses). */
export function weeklySpend(runs: readonly RunDoc[], now: Date): number {
  const since = now.getTime() - 7 * DAY;
  let sum = 0;
  for (const r of runs) {
    const t = Date.parse(r.started);
    if (Number.isFinite(t) && t >= since && t <= now.getTime()) sum += Number(r.spent_usd) || 0;
  }
  return Math.round(sum * 100) / 100;
}

const COULDNT = "Couldn't read";

/** How things are: six tiles, each a link into its door. */
export function tiles(input: InboxInput): InboxTile[] {
  const week = input.now.getTime() - 7 * DAY;
  const lp = input.lastPublished;
  const jobs = input.jobs;
  const recent = jobs?.filter((j) => j.at !== null && new Date(j.at).getTime() >= week) ?? [];
  const failed = recent.filter((j) => j.outcome === "failed").length;
  const ok = recent.filter((j) => j.outcome === "ok").length;
  const spent = input.runs ? weeklySpend(input.runs, input.now) : null;
  return [
    {
      label: "Live version",
      value: lp === undefined ? COULDNT : lp === null ? "None yet" : `#${lp.id}`,
      note: lp ? [`Published ${fmtDate(lp.created_at)}`, lp.colleges !== null ? plural(lp.colleges, "college") : null].filter(Boolean).join(" · ") : undefined,
      href: "/admin/data/versions",
      help: "published-version",
    },
    {
      label: "Review queue",
      value: input.queue ? input.queue.open.toLocaleString("en-US") : COULDNT,
      note: input.queue ? `${input.queue.newThisWeek.toLocaleString("en-US")} new in 7 days` : undefined,
      href: "/admin/steward/findings",
      help: "review-item",
    },
    {
      label: "Data health",
      value: input.health ? `${input.health.fresh.toLocaleString("en-US")} fresh` : COULDNT,
      note: input.health ? `${input.health.watch.toLocaleString("en-US")} watch · ${input.health.stale.toLocaleString("en-US")} stale · ${input.health.failing.toLocaleString("en-US")} failing` : undefined,
      href: "/admin/data/health",
      help: "data-health",
    },
    {
      label: "Jobs, last 7 days",
      value: jobs ? `${ok.toLocaleString("en-US")} ok` : COULDNT,
      note: jobs ? `${plural(failed, "failed", "failed")} · ${plural(jobs.length, "job")} in all` : undefined,
      href: "/admin/steward/jobs",
      help: "job",
    },
    {
      label: "People",
      value: input.counts ? input.counts.people.toLocaleString("en-US") : COULDNT,
      note: input.counts
        ? [plural(input.counts.households, "household"), input.counts.organizations !== null ? plural(input.counts.organizations, "organization") : null].filter(Boolean).join(" · ")
        : undefined,
      href: "/admin/people",
      help: "people",
    },
    {
      label: "Steward spend, 7 days",
      value: spent === null ? COULDNT : usd(spent),
      note: spent === null ? undefined : `of the ${usd(STEWARD_WEEKLY_CAP_USD)} weekly budget`,
      href: "/admin/steward/runs",
      help: "steward-runs",
    },
  ];
}

/** The empty Needs you line: "Nothing needs you. The Steward last looked at {time}." */
export function nothingNeedsYou(runs: readonly RunDoc[] | null): string {
  const last = runs?.[0]?.finished ?? runs?.[0]?.started ?? null;
  return `Nothing needs you. The Steward last looked at ${last ? fmtDateTime(last) : "nothing yet"}.`;
}

/** The Steward's last run of each mode, newest first ("The Steward did"). */
export function lastRunsByMode(runs: readonly RunDoc[] | null): RunDoc[] {
  const seen = new Set<string>();
  const out: RunDoc[] = [];
  for (const r of runs ?? []) {
    if (seen.has(r.mode)) continue;
    seen.add(r.mode);
    out.push(r);
  }
  return out;
}

/** "Wrote 3 findings, 2 proposals, 1 To do row" for a run (counts that are zero are left out). */
export function runWrote(r: RunDoc): string {
  const parts = [
    r.issues ? plural(r.issues, "finding") : null,
    r.proposals ? plural(r.proposals, "proposal") : null,
    r.todo ? plural(r.todo, "To do row") : null,
    r.decisions ? plural(r.decisions, "question") : null,
    r.audits ? plural(r.audits, "audit") : null,
    r.reviews ? plural(r.reviews, "job review") : null,
  ].filter(Boolean);
  const wrote = parts.length ? `Wrote ${parts.join(", ")}` : "Wrote nothing new";
  return r.repairs ? `${wrote}; made ${plural(r.repairs, "repair")}` : wrote;
}

/** Dollars the job reviews spent in the seven days before `now` (their own $3 a week). */
export function weeklyReviewSpend(runs: readonly RunDoc[], now: Date): number {
  return weeklySpend(runs.filter((r) => r.mode === "review"), now);
}

/** The job reviews' weekly budget (scripts/lib/steward/budget.mts `REVIEW_BUDGETS.week`; a test checks they agree). */
export const REVIEW_WEEKLY_CAP_USD = 3;

export const RUN_MODE_LABEL: Readonly<Record<string, string>> = { run: "Run", audit: "Audit", apply: "Apply", answer: "Answer", review: "Job review" };
