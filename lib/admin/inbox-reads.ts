import "server-only";
/**
 * The reads behind the Inbox (lib/admin/inbox.ts, pure): each one from what the console already reads elsewhere, each
 * made soft (a failed read is null, and the Inbox leaves its rows or tile out), so the home page never fails because
 * one source is down. Admin only: callers check requireAdmin() first; every read goes through the admin's own session.
 *
 * Every read is a React `cache()`d function (per request; specs/product/admin-speed.md "Wave 1" fix 4), so the
 * layout's badge (`needsYouCount`) and the Inbox's three panels, rendering in the same request, read each source once:
 * the badge's seven reads (decisions, proposals, deletions, invitations, held changes, collisions, the last publish)
 * are the same promises the "Needs you" and "How things are" panels await. A cached read keeps its soft null, so a
 * source that failed for the badge isn't asked again by the page.
 *
 * `needsYouCount` is the tab bar's badge, read by app/admin/layout.tsx on every console page, so it reads only the
 * cheap sources and not the jobs (GitHub, through lib/jobs/github-memo.ts) or To do (the engines' records); the Inbox
 * itself lists those too. The page's panels each have a loader: `loadNeedsYou`, `loadStewardDid`, `loadHowThingsAre`
 * (app/admin/page.tsx streams each under its own <Suspense>). The review queue's tile reads the counts
 * (`readQueueCounts`, one call), never the whole queue.
 */
import { cache } from "react";
import { adminCounts } from "@/lib/admin/console-reads";
import { heldChangeSets, lastPublishAndWaiting } from "@/lib/admin/data-reads";
import { healthOverview } from "@/lib/admin/health";
import { INVITATION_WAIT_DAYS, inboxJob, needsYou, type InboxDeletion, type InboxInput, type InboxInvitation, type InboxPublish } from "@/lib/admin/inbox";
import { adminSupabase } from "@/lib/admin/people";
import { readCollisionIssues, type DocumentsClient } from "@/lib/admin/document-reads";
import { readQueueCounts, type StoreClient } from "@/lib/admin/review-queue";
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

/** The admin's client, once per request. */
const db = cache((): Promise<Db> => adminSupabase());
const store = async () => (await db()) as unknown as StoreClient;

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

/* ------------------------------------------------------------------ */
/* The per-request reads (each soft, each once)                         */
/* ------------------------------------------------------------------ */

// The badge's seven.
const decisionsRead = cache(() => soft("decisions", async () => readDecisions(await store())));
const proposalsRead = cache(() => soft("proposals", async () => readProposals(await store())));
const deletionsRead = cache(() => soft("deletions", async () => deletions(await db())));
// Invitations waiting a week or more: the cutoff is taken when the read starts (a request's few milliseconds apart don't matter).
const invitationsRead = cache(() => soft("invitations", async () => waitingInvitations(await db(), new Date())));
const heldRead = cache(() => soft("held changes", async () => heldChangeSets(await db())));
const collisionsRead = cache(() => soft("collision findings", async () => readCollisionIssues((await store()) as unknown as DocumentsClient)));
const publishRead = cache(() => soft("the last publish", async () => lastPublishAndWaiting(await db())));

// The page's others.
const todoRead = cache(() => soft("to do", async () => readTodo(await store())));
const runsRead = cache(() => soft("steward runs", async () => readRuns(await store(), 50)));
const jobsRead = cache(() => soft("jobs", async () => (await loadJobsOverview(new Date())).rows.map(inboxJob)));
const countsRead = cache(() => soft("counts", () => adminCounts()));
const organizationsRead = cache(() => soft("organizations", async () => organizationCount(await db())));
const queueRead = cache(() =>
  soft("the review queue", async () => {
    const c = await readQueueCounts(await store());
    if (!c) throw new Error("the counts couldn't be read");
    return { open: c.open, newThisWeek: c.newWeek };
  }),
);
const healthRead = cache(() =>
  soft("data health", async () => {
    const o = (await healthOverview()).counts.overall;
    return { fresh: o.fresh, watch: o.watch, stale: o.stale, failing: o.failing };
  }),
);

/** An InboxInput with nothing read: each panel fills in what it shows. */
function blank(now: Date): InboxInput {
  return {
    now,
    decisions: null,
    proposals: null,
    todo: null,
    jobs: null,
    deletions: null,
    invitations: null,
    heldChanges: null,
    runs: null,
    counts: null,
    lastPublished: null,
    queue: null,
    health: null,
    collisions: null,
    publish: null,
  };
}

/** The badge's seven reads, as one InboxInput (the rest left null). */
async function cheapInput(now: Date): Promise<InboxInput> {
  const [decisions, proposals, dels, invites, held, collisions, published] = await Promise.all([decisionsRead(), proposalsRead(), deletionsRead(), invitationsRead(), heldRead(), collisionsRead(), publishRead()]);
  return { ...blank(now), decisions, proposals, deletions: dels, invitations: invites, heldChanges: held, collisions, publish: published ? inboxPublish(published) : null };
}

/* ------------------------------------------------------------------ */
/* The panels' loaders                                                  */
/* ------------------------------------------------------------------ */

/** "Needs you": the badge's seven, To do, the jobs, and the Steward's runs (for the empty line's "last looked at"). */
export async function loadNeedsYou(now: Date = new Date()): Promise<InboxInput> {
  const [cheap, todo, jobs, runs] = await Promise.all([cheapInput(now), todoRead(), jobsRead(), runsRead()]);
  return { ...cheap, todo, jobs, runs };
}

/** "The Steward did": its runs. */
export async function loadStewardDid(now: Date = new Date()): Promise<InboxInput> {
  return { ...blank(now), runs: await runsRead() };
}

/** "How things are": the six tiles' reads (the last publish, the queue's counts, health, the jobs, people, the Steward's spend). */
export async function loadHowThingsAre(now: Date = new Date()): Promise<InboxInput> {
  const [counts, orgs, published, queue, health, jobs, runs] = await Promise.all([countsRead(), organizationsRead(), publishRead(), queueRead(), healthRead(), jobsRead(), runsRead()]);
  return {
    ...blank(now),
    counts: counts ? { people: counts.people, households: counts.households, organizations: orgs } : null,
    lastPublished: published === null ? undefined : published.lastPublished ? { id: published.lastPublished.id, created_at: published.lastPublished.created_at, colleges: published.lastPublished.manifest?.colleges ?? null } : null,
    queue,
    health,
    jobs,
    runs,
    publish: published ? inboxPublish(published) : null,
  };
}

/** The tab bar's count: Needs you over the cheap reads; null when nothing could be read. */
export async function needsYouCount(now: Date = new Date()): Promise<number | null> {
  try {
    const input = await cheapInput(now);
    if ([input.decisions, input.proposals, input.deletions, input.invitations, input.heldChanges].every((r) => r === null)) return null;
    return needsYou(input).length;
  } catch {
    return null;
  }
}
