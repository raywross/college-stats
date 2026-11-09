import "server-only";
/**
 * The reads behind the Inbox (lib/admin/inbox.ts, pure): each one from what the console already reads elsewhere, each
 * made soft (a failed read is null, and the Inbox leaves its rows or tile out), so the home page never fails because
 * one source is down. Admin only: callers check requireAdmin() first; every read goes through the admin's own session.
 *
 * `needsYouCount` is the tab bar's badge, read by app/admin/layout.tsx on every console page, so it reads only the
 * cheap sources (the Steward's decisions and proposals, held changes, deletions, invitations, the changes waiting for
 * a publish) and not the jobs (a GitHub call per workflow) or To do (the engines' records); the Inbox itself lists
 * those too.
 */
import { adminCounts } from "@/lib/admin/console-reads";
import { heldChangeSets, lastPublishAndWaiting } from "@/lib/admin/data-reads";
import { healthOverview } from "@/lib/admin/health";
import { INVITATION_WAIT_DAYS, inboxJob, needsYou, type InboxDeletion, type InboxInput, type InboxInvitation, type InboxPublish } from "@/lib/admin/inbox";
import { adminSupabase } from "@/lib/admin/people";
import { readCollisionIssues, type DocumentsClient } from "@/lib/admin/document-reads";
import { readQueue, type StoreClient } from "@/lib/admin/review-queue";
import { readDecisions, readProposals, readRuns, readTodo } from "@/lib/admin/steward-reads";
import { loadJobsOverview } from "@/lib/jobs/runs";

async function soft<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    console.error(`admin inbox: reading ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

type Db = Awaited<ReturnType<typeof adminSupabase>>;

/** The applied changes waiting since the last publish, as the Inbox reads them (the same read as /admin/data's). */
function inboxPublish(read: Awaited<ReturnType<typeof lastPublishAndWaiting>>): InboxPublish {
  return { waiting: read.waiting.count, oldestAt: read.waiting.oldestAt, lastPublishedAt: read.lastPublished?.created_at ?? null };
}

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

/** Everything the Inbox shows. */
export async function loadInboxInput(now: Date = new Date()): Promise<InboxInput> {
  const s = await adminSupabase();
  const client = s as unknown as StoreClient;
  const [decisions, proposals, todo, runs, jobs, dels, invites, held, counts, orgs, published, queue, health, collisions] = await Promise.all([
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
    soft("the last publish", () => lastPublishAndWaiting(s)),
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
    soft("collision findings", () => readCollisionIssues(client as unknown as DocumentsClient)),
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
    lastPublished: published === null ? undefined : published.lastPublished ? { id: published.lastPublished.id, created_at: published.lastPublished.created_at, colleges: published.lastPublished.manifest?.colleges ?? null } : null,
    queue,
    health,
    collisions,
    publish: published ? inboxPublish(published) : null,
  };
}

/** The tab bar's count: Needs you over the cheap reads; null when nothing could be read. */
export async function needsYouCount(now: Date = new Date()): Promise<number | null> {
  try {
    const s = await adminSupabase();
    const client = s as unknown as StoreClient;
    const [decisions, proposals, dels, invites, held, collisions, published] = await Promise.all([
      soft("decisions", () => readDecisions(client)),
      soft("proposals", () => readProposals(client)),
      soft("deletions", () => deletions(s)),
      soft("invitations", () => waitingInvitations(s, now)),
      soft("held changes", () => heldChangeSets(s)),
      soft("collision findings", () => readCollisionIssues(client as unknown as DocumentsClient)),
      soft("the last publish", () => lastPublishAndWaiting(s)),
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
      collisions,
      publish: published ? inboxPublish(published) : null,
    }).length;
  } catch {
    return null;
  }
}
