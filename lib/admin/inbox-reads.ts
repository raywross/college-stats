import "server-only";
/**
 * The reads behind the Inbox (lib/admin/inbox.ts, pure): each one from what the console already reads elsewhere, each
 * made soft (a failed read is null, and the Inbox leaves its rows or tile out), so the home page never fails because
 * one source is down. Admin only: callers check requireAdmin() first; every read goes through the admin's own session.
 *
 * `needsYouCount` is the tab bar's badge, read by app/admin/layout.tsx on every console page, so it reads only the
 * cheap sources (the Steward's decisions and proposals, held changes, deletions, invitations) and not the jobs (a
 * GitHub call per workflow) or To do (the engines' records); the Inbox itself lists those too.
 */
import { adminCounts } from "@/lib/admin/console-reads";
import { heldChangeSets, lastPublishedSnapshot } from "@/lib/admin/data-reads";
import { healthOverview } from "@/lib/admin/health";
import { INVITATION_WAIT_DAYS, needsYou, withReview, type InboxDeletion, type InboxInput, type InboxInvitation, type InboxJob } from "@/lib/admin/inbox";
import { adminSupabase } from "@/lib/admin/people";
import { readQueue, type StoreClient } from "@/lib/admin/review-queue";
import { readDecisions, readProposals, readRuns, readTodo } from "@/lib/admin/steward-reads";
import { loadJobsOverview, type JobOverviewRow } from "@/lib/jobs/runs";
import { lastOutcome } from "@/lib/jobs/view";

async function soft<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    console.error(`admin inbox: reading ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

type Db = Awaited<ReturnType<typeof adminSupabase>>;

async function deletions(s: Db): Promise<InboxDeletion[]> {
  const { data, error } = await s.from("profiles").select("id, display_name, deleted_at").not("deleted_at", "is", null).order("deleted_at", { ascending: true }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string; display_name: string | null; deleted_at: string }) => ({ id: r.id, name: r.display_name, deletedAt: r.deleted_at }));
}

async function waitingInvitations(s: Db, now: Date): Promise<InboxInvitation[]> {
  const before = new Date(now.getTime() - INVITATION_WAIT_DAYS * 86_400_000).toISOString();
  const { data, error } = await s
    .from("invitations_admin")
    .select("id, household_id, email, created")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .lt("created", before)
    .order("created", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string; household_id: string; email: string; created: string }) => ({ id: r.id, householdId: r.household_id, email: r.email, created: r.created }));
}

async function organizationCount(s: Db): Promise<number> {
  const { count, error } = await s.from("organizations").select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
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

/** Everything the Inbox shows. */
export async function loadInboxInput(now: Date = new Date()): Promise<InboxInput> {
  const s = await adminSupabase();
  const client = s as unknown as StoreClient;
  const [decisions, proposals, todo, runs, jobs, dels, invites, held, counts, orgs, published, queue, health] = await Promise.all([
    soft("decisions", () => readDecisions(client)),
    soft("proposals", () => readProposals(client)),
    soft("to do", () => readTodo(client)),
    soft("steward runs", () => readRuns(client, 50)),
    soft("jobs", async () => (await loadJobsOverview(now)).rows.map(inboxJob)),
    soft("deletions", () => deletions(s)),
    soft("invitations", () => waitingInvitations(s, now)),
    soft("held changes", () => heldChangeSets(s)),
    soft("counts", () => adminCounts()),
    soft("organizations", () => organizationCount(s)),
    soft("the last publish", () => lastPublishedSnapshot(s)),
    soft("the review queue", async () => {
      const q = await readQueue(client);
      if (!q.ok) throw new Error(q.reason);
      const week = now.getTime() - 7 * 86_400_000;
      const open = q.rows.filter((r) => r.status === "open");
      return { open: open.length, newThisWeek: open.filter((r) => Date.parse(r.item.queued) >= week).length };
    }),
    soft("data health", async () => {
      const o = (await healthOverview()).counts.overall;
      return { fresh: o.fresh, watch: o.watch, stale: o.stale, failing: o.failing };
    }),
  ]);
  return {
    now,
    decisions,
    proposals,
    todo,
    runs,
    jobs,
    deletions: dels,
    invitations: invites,
    heldChanges: held,
    counts: counts ? { people: counts.people, households: counts.households, organizations: orgs } : null,
    lastPublished: published === null ? undefined : published ? { id: published.id, created_at: published.created_at, colleges: published.manifest?.colleges ?? null } : null,
    queue,
    health,
  };
}

/** The tab bar's count: Needs you over the cheap reads; null when nothing could be read. */
export async function needsYouCount(now: Date = new Date()): Promise<number | null> {
  try {
    const s = await adminSupabase();
    const client = s as unknown as StoreClient;
    const [decisions, proposals, dels, invites, held] = await Promise.all([
      soft("decisions", () => readDecisions(client)),
      soft("proposals", () => readProposals(client)),
      soft("deletions", () => deletions(s)),
      soft("invitations", () => waitingInvitations(s, now)),
      soft("held changes", () => heldChangeSets(s)),
    ]);
    if ([decisions, proposals, dels, invites, held].every((r) => r === null)) return null;
    return needsYou({
      now,
      decisions,
      proposals,
      todo: null,
      jobs: null,
      deletions: dels,
      invitations: invites,
      heldChanges: held,
      runs: null,
      counts: null,
      lastPublished: null,
      queue: null,
      health: null,
    }).length;
  } catch {
    return null;
  }
}
