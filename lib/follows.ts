"use server";
/**
 * Server Actions for following colleges (specs/product/follow-colleges.md). Every read and write runs with the
 * signed-in user's own Supabase session, so the follows policies (supabase/migrations/20261005140000_follows.sql)
 * decide: a user only ever sees and changes their own rows. Types and the pure rules live in lib/follow-state.ts.
 *
 * Public pages (profiles, compare) call these from client components; they never read cookies during render.
 */
import { getUser, authConfigured } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { getData } from "@/lib/data";
import { FOLLOW_MESSAGES, followWrite, isUnitId, type FollowFailure, type FollowResult, type FollowRow, type FollowSource, type FollowState } from "@/lib/follow-state";

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

function failure(reason: FollowFailure, detail?: string): FollowResult {
  if (detail) console.error(`follows: ${reason}: ${detail}`);
  return { ok: false, reason, message: FOLLOW_MESSAGES[reason] };
}

type Ready = { userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> };

/** The signed-in user and their client, or why there isn't one. */
async function ready(): Promise<Ready | FollowFailure> {
  if (!authConfigured()) return "not-configured";
  const user = await getUser();
  if (!user) return "signed-out";
  return { userId: user.id, supabase: await createServerSupabase() };
}

async function readSource(r: Ready, unitId: string): Promise<{ source: FollowSource | null } | { error: { code?: string; message?: string } }> {
  const { data, error } = await r.supabase.from("follows").select("source").eq("user_id", r.userId).eq("unit_id", unitId).maybeSingle();
  if (error) return { error };
  return { source: (data?.source as FollowSource | undefined) ?? null };
}

/** Whether the signed-in user follows this college, and how. Never throws: unconfigured or signed out says so. */
export async function getFollow(unitId: string): Promise<FollowState> {
  const r = await ready();
  if (r === "not-configured") return { available: false };
  if (typeof r === "string") return { available: true, signedIn: false };
  if (!isUnitId(unitId)) return { available: true, signedIn: true, following: false, source: null };
  const read = await readSource(r, unitId);
  if ("error" in read) {
    console.error(`follows: reading ${unitId} failed: ${read.error.message}`);
    return { available: true, signedIn: true, following: false, source: null };
  }
  return { available: true, signedIn: true, following: read.source !== null, source: read.source };
}

/** Follow a college by hand. A follow that came from a saved list becomes a manual one (followWrite). */
export async function follow(unitId: string): Promise<FollowResult> {
  if (!isUnitId(unitId) || !(await getData()).getSchoolById(unitId)) return failure("unknown-college");
  const r = await ready();
  if (typeof r === "string") return failure(r);
  const read = await readSource(r, unitId);
  if ("error" in read) return failure(isMissingTable(read.error) ? "not-set-up" : "error", read.error.message);
  const write = followWrite(read.source);
  if (write !== "none") {
    const { error } =
      write === "insert"
        ? await r.supabase.from("follows").insert({ user_id: r.userId, unit_id: unitId, source: "manual" })
        : await r.supabase.from("follows").update({ source: "manual" }).eq("user_id", r.userId).eq("unit_id", unitId);
    // 23505: a second click raced the first; the row is there either way.
    if (error && error.code !== "23505") return failure(isMissingTable(error) ? "not-set-up" : "error", error.message);
  }
  return { ok: true, state: { available: true, signedIn: true, following: true, source: "manual" } };
}

/** Stop following a college, however it was followed. A list follow comes back only if the college is added to a list again. */
export async function unfollow(unitId: string): Promise<FollowResult> {
  if (!isUnitId(unitId)) return failure("unknown-college");
  const r = await ready();
  if (typeof r === "string") return failure(r);
  const { error } = await r.supabase.from("follows").delete().eq("user_id", r.userId).eq("unit_id", unitId);
  if (error) return failure(isMissingTable(error) ? "not-set-up" : "error", error.message);
  return { ok: true, state: { available: true, signedIn: true, following: false, source: null } };
}

/** The signed-in user's follows, newest first; empty when signed out, unconfigured, or before the migration. */
export async function myFollows(): Promise<FollowRow[]> {
  const r = await ready();
  if (typeof r === "string") return [];
  const { data, error } = await r.supabase.from("follows").select("unit_id, source, created").eq("user_id", r.userId).order("created", { ascending: false });
  if (error) {
    console.error(`follows: listing failed: ${error.message}`);
    return [];
  }
  return data as FollowRow[];
}
