import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { trackServer } from "@/lib/analytics-server";
import { clientIp, createLimiter, take } from "@/lib/chances/rate-limit";
import { allowed } from "@/lib/entitlements";
import { countText, type CountKind } from "@/lib/essays/count";
import { loadGuidance } from "@/lib/essays/guidance";
import { isMissingTable, promptLookup } from "@/lib/essays/load";
import { resolvePrompt, type EssayKind } from "@/lib/essays/prompts";
import { handleReview, type Allowance, type LoadedDraft, type RecordInput, type ReviewDeps, type StoredReview } from "@/lib/essays/review";
import { reviewResponse } from "@/lib/essays/review-response";
import type { ContextDraft, ContextInput } from "@/lib/essays/review-context";
import type { NoteCategory } from "@/lib/essays/rubric";
import { myLists } from "@/lib/lists";
import { isUuid } from "@/lib/planner/plan-writes";
import { profileFor } from "@/lib/student-profile-store";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * /api/essays/review (specs/product/essays/reviewer.md; the Essays build brief "U5b Reviewer"):
 *
 *   POST  { essayId, versionId? }  → NDJSON events         A reader's notes on a version of the student's draft (the draft
 *                                                           as saved now when no version is named; it is kept as a
 *                                                           version first, so the notes stay with the words they read).
 *                                                           Refusals before the read are JSON { error } with a status;
 *                                                           once the read starts: reading, note…, then done { review,
 *                                                           message } or error { error } (reviewer.md "the notes
 *                                                           stream in").
 *   GET   ?essayId=…               → { reviews }           The draft's reviews, newest first, with their notes (the
 *                                                           student or a guardian in the household; RLS decides).
 *   PATCH { noteId, state }        → { ok }                The student marks a note done, ignored, or open again.
 *
 * POST's decision is lib/essays/review.ts `handleReview` (tested with fakes in tests/essays-review.test.mts); this file
 * wires the session, the database (every read and write with the caller's own session, so row-level security and the
 * migration's functions decide), the limiter, and the client. The model call needs ANTHROPIC_API_KEY on the server.
 * Never cached.
 */

export const maxDuration = 120;

/** Per server instance (as /api/estimate): a review is a model call, so the buckets are small. */
const limiter = createLimiter({ ip: { capacity: 20, refillPerSecond: 0.1 }, user: { capacity: 8, refillPerSecond: 0.05 } });

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });

/** The label a version made for a review carries in the version list. */
const REVIEW_VERSION_LABEL = "Notes asked for";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;
type NoteRow = { id: string; review_id: string; position: number; category: NoteCategory; span: StoredReview["notes"][number]["span"]; observation: string; why: string; source: string | null; ask: string; fix: string | null; state: "open" | "done" | "ignored" };
type ReviewRow = { id: string; version_id: string; created: string; outcome: StoredReview["outcome"]; method: string };

const NOTE_COLUMNS = "id, review_id, position, category, span, observation, why, source, ask, fix, state";
const REVIEW_COLUMNS = "id, version_id, created, outcome, method";

function assemble(reviews: ReviewRow[], notes: NoteRow[]): StoredReview[] {
  return reviews.map((r) => ({
    ...r,
    notes: notes
      .filter((n) => n.review_id === r.id)
      .sort((a, b) => a.position - b.position)
      .map(({ id, category, span, observation, why, source, ask, fix, state }) => ({ id, category, span, observation, why, source, ask, fix, state })),
  }));
}

async function readReviews(supabase: Supabase, essayId: string, limit = 10): Promise<StoredReview[] | "setup-missing"> {
  const reviews = await supabase.from("essay_reviews").select(REVIEW_COLUMNS).eq("essay_id", essayId).order("created", { ascending: false }).limit(limit);
  if (reviews.error) {
    if (isMissingTable(reviews.error)) return "setup-missing";
    throw new Error(`Reading reviews failed: ${reviews.error.message}`);
  }
  const rows = (reviews.data ?? []) as ReviewRow[];
  if (rows.length === 0) return [];
  const notes = await supabase.from("essay_notes").select(NOTE_COLUMNS).in("review_id", rows.map((r) => r.id));
  if (notes.error) throw new Error(`Reading notes failed: ${notes.error.message}`);
  return assemble(rows, (notes.data ?? []) as NoteRow[]);
}

/** The real dependencies of handleReview, for one request. */
function deps(request: Request, supabaseP: Promise<Supabase>): ReviewDeps {
  const ip = clientIp(request.headers);
  return {
    user: () => getUser(),
    allowed: (user) => allowed(user, "advisor.reviews"),
    limit: (userId) => take(limiter, { ip, userId }, 1),

    async loadDraft(essayId, versionId): Promise<LoadedDraft> {
      const supabase = await supabaseP;
      const essay = await supabase.from("essays").select("id, student_id, prompt_ref, kind, body, count_kind").eq("id", essayId).maybeSingle();
      if (essay.error) {
        if (isMissingTable(essay.error)) return { kind: "setup-missing" };
        throw new Error(`Reading the draft failed: ${essay.error.message}`);
      }
      const row = essay.data as { id: string; student_id: string; prompt_ref: string; kind: EssayKind; body: string; count_kind: CountKind } | null;
      if (!row) return { kind: "not-found" };
      const own = await supabase.rpc("is_own_essay", { p_essay: essayId });
      if (own.error || own.data !== true) return { kind: "not-student" };
      const base = { essayId, promptKind: row.kind, promptRef: row.prompt_ref, studentId: row.student_id };

      if (versionId) {
        const v = await supabase.from("essay_versions").select("id, body").eq("id", versionId).eq("essay_id", essayId).maybeSingle();
        const version = v.data as { id: string; body: string } | null;
        return version ? { kind: "ready", ...base, versionId: version.id, body: version.body } : { kind: "not-found" };
      }
      // The draft as saved now: its newest version when that is the same text, else a new version of it.
      const last = await supabase.from("essay_versions").select("id, body").eq("essay_id", essayId).order("created", { ascending: false }).limit(1);
      const newest = ((last.data ?? []) as { id: string; body: string }[])[0];
      if (newest && newest.body === row.body) return { kind: "ready", ...base, versionId: newest.id, body: row.body };
      const made = await supabase
        .from("essay_versions")
        .insert({ essay_id: essayId, body: row.body, count: countText(row.body, row.count_kind), source: "typed", label: REVIEW_VERSION_LABEL })
        .select("id")
        .single();
      if (made.error || !made.data) throw new Error(`Keeping the version failed: ${made.error?.message ?? "no row"}`);
      return { kind: "ready", ...base, versionId: (made.data as { id: string }).id, body: row.body };
    },

    async allowance(essayId): Promise<Allowance> {
      const supabase = await supabaseP;
      const { data, error } = await supabase.rpc("essay_review_allowance", { p_essay: essayId });
      if (error) throw new Error(`The allowance failed: ${error.message}`);
      const a = data as { ok?: boolean; reason?: string | null } | null;
      if (a?.ok === true) return { ok: true };
      const reason = a?.reason === "draft_day" || a?.reason === "student_day" || a?.reason === "draft_cycle" ? a.reason : "not_yours";
      return { ok: false, reason };
    },

    async contextInput(draft): Promise<ContextInput> {
      const supabase = await supabaseP;
      const lookup = await promptLookup();
      const prompt = resolvePrompt(draft.promptRef, lookup);
      const unitId = prompt.college?.unit_id ?? null;
      const [profile, drafts, prior, interest] = await Promise.all([
        profileFor(draft.studentId),
        supabase.from("essays").select("id, title, prompt_ref, kind, body").eq("student_id", draft.studentId).order("updated", { ascending: false }).limit(200),
        readReviews(supabase, draft.essayId, 4).catch(() => [] as StoredReview[]),
        unitId ? interestFor(supabase, draft.studentId, unitId) : Promise.resolve(null),
      ]);
      const rows = (drafts.data ?? []) as { id: string; title: string; prompt_ref: string; kind: EssayKind; body: string }[];
      const links = rows.length ? await supabase.from("essay_links").select("essay_id, prompt_ref").in("essay_id", rows.map((d) => d.id)) : { data: [] };
      const linkRows = (links.data ?? []) as { essay_id: string; prompt_ref: string }[];
      const draftRows: ContextDraft[] = rows.map((d) => ({
        ...d,
        refs: [d.prompt_ref, ...linkRows.filter((l) => l.essay_id === d.id).map((l) => l.prompt_ref)],
      }));
      return {
        essayId: draft.essayId,
        prompt: { title: prompt.title, text: prompt.text, options: prompt.options, kind: prompt.kind, limit: prompt.limit, required: prompt.required, college: prompt.college, quote: prompt.quote },
        school: unitId ? lookup.schoolRecord(unitId) : null,
        profile: profile?.data ?? null,
        studentName: profile?.student.display_name ?? null,
        drafts: draftRows,
        interest,
        priorNotes: prior === "setup-missing" ? [] : prior.flatMap((r) => r.notes.map((n) => ({ category: n.category, observation: n.observation, state: n.state }))),
      };
    },

    guidance: () => loadGuidance(),
    client: () => (process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 1, timeout: 110_000 }) : null),

    async record(r: RecordInput) {
      const supabase = await supabaseP;
      const { data, error } = await supabase.rpc("record_essay_review", {
        p_essay: r.essayId,
        p_version: r.versionId,
        p_method: r.method,
        p_model: r.model,
        p_outcome: r.outcome,
        p_usage: r.usage,
        p_dropped: r.dropped,
        p_notes: r.notes,
      });
      if (error) {
        if (/essay_review_cap/.test(error.message ?? "")) return { ok: false, reason: "cap" } as const;
        console.error(`essays: recording the review failed: ${error.message}`);
        return { ok: false, reason: "failed" } as const;
      }
      const id = data as string;
      const all = await readReviews(supabase, r.essayId, 1);
      const review = all === "setup-missing" ? undefined : all.find((x) => x.id === id);
      return review ? ({ ok: true, review } as const) : ({ ok: false, reason: "failed" } as const);
    },

    track: (e, userId) => {
      void trackServer(e.event, e.properties as never, userId);
    },
  };
}

/** The plan's interest acts for one college: a visit, an information request, following on social. */
async function interestFor(supabase: Supabase, studentId: string, unitId: string): Promise<ContextInput["interest"]> {
  try {
    const lists = await myLists({ kind: "student", id: studentId });
    const list = lists.find((l) => l.is_default) ?? lists[0];
    if (!list) return null;
    const { data } = await supabase.from("list_items").select("id, visited_on, info_requested_on, followed_networks, follows_social").eq("list_id", list.id).eq("unit_id", unitId).maybeSingle();
    const item = data as { id: string; visited_on: string | null; info_requested_on: string | null; followed_networks: string[] | null; follows_social: boolean | null } | null;
    if (!item) return null;
    const visits = await supabase.from("plan_visits").select("id", { count: "exact", head: true }).eq("item_id", item.id);
    return {
      visited: item.visited_on !== null || (visits.count ?? 0) > 0,
      requestedInfo: item.info_requested_on !== null,
      followsSocial: (item.followed_networks?.length ?? 0) > 0 || item.follows_social === true,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  // Checks before the model call answer as JSON; once the read starts, the events stream as NDJSON.
  return reviewResponse(
    (send) => handleReview(deps(request, createServerSupabase()), body, send),
    (reply) => json(reply.body, reply.status, reply.headers),
  );
}

export async function GET(request: Request) {
  const essayId = new URL(request.url).searchParams.get("essayId");
  if (!essayId || !isUuid(essayId)) return json({ error: "Name the draft." }, 400);
  const user = await getUser().catch(() => null);
  if (!user) return json({ error: "Sign in first." }, 401);
  try {
    const reviews = await readReviews(await createServerSupabase(), essayId);
    if (reviews === "setup-missing") return json({ reviews: [], setup: false });
    return json({ reviews });
  } catch (e) {
    console.error(`essays: reading reviews failed: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "That didn't work. Try again in a moment." }, 500);
  }
}

export async function PATCH(request: Request) {
  let body: { noteId?: unknown; state?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  const noteId = typeof body.noteId === "string" && isUuid(body.noteId) ? body.noteId : null;
  const state = body.state === "open" || body.state === "done" || body.state === "ignored" ? body.state : null;
  if (!noteId || !state) return json({ error: "Name the note and its state." }, 400);
  const user = await getUser().catch(() => null);
  if (!user) return json({ error: "Sign in first." }, 401);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("essay_notes").update({ state }).eq("id", noteId).select("id");
  if (error) {
    console.error(`essays: marking a note failed: ${error.message}`);
    return json({ error: "That didn't work. Try again in a moment." }, 500);
  }
  if (!data?.length) return json({ error: "Only the student marks a note." }, 403);
  return json({ ok: true });
}
