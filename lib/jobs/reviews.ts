/**
 * The Steward's job reviews as the console reads them (`steward.reviews`, specs/product/admin-redesign.md "What the
 * Steward reviews"): by exact key for the runs a page shows, and the newest one of a job when its last run has none (the
 * half-hourly collect is never reviewed). Reads `data_documents` through the admin's own client (it selects for
 * everyone); callers check `requireAdmin()` first. Never throws into a page: a read that fails is an empty map.
 */
import { reviewKey } from "../steward/job-review.ts";
import { REVIEWS_COLLECTION, type ReviewDoc } from "../steward/types.ts";

/** The parts of a Supabase client these reads use. */
export interface ReviewsClient {
  from(table: string): { select(cols: string): ReviewsQuery };
}
interface ReviewsQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(col: string, v: unknown): ReviewsQuery;
  in(col: string, v: readonly unknown[]): ReviewsQuery;
  like(col: string, v: string): ReviewsQuery;
  order(col: string, o: { ascending: boolean }): ReviewsQuery;
  limit(n: number): ReviewsQuery;
}

/** The reviews of these runs, by `<job>:<ref>`. */
export async function reviewsOf(client: ReviewsClient, runs: readonly { job: string; ref: string }[]): Promise<Map<string, ReviewDoc>> {
  const out = new Map<string, ReviewDoc>();
  const keys = [...new Set(runs.map((r) => reviewKey(r.job, r.ref)))];
  if (!keys.length) return out;
  try {
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await client.from("data_documents").select("key, body").eq("collection", REVIEWS_COLLECTION).in("key", keys.slice(i, i + 100));
      if (error) return out;
      for (const r of (data ?? []) as { key: string; body: ReviewDoc }[]) out.set(r.key, r.body);
    }
  } catch {
    // The page shows "Not reviewed" for these runs.
  }
  return out;
}

/** The newest review of each job (one small read per job; `<job>:` keys, newest write first). */
export async function latestReviews(client: ReviewsClient, jobs: readonly string[]): Promise<Map<string, ReviewDoc>> {
  const out = new Map<string, ReviewDoc>();
  await Promise.all(
    jobs.map(async (job) => {
      try {
        const { data, error } = await client
          .from("data_documents")
          .select("key, body")
          .eq("collection", REVIEWS_COLLECTION)
          .like("key", `${job}:%`)
          .order("updated_at", { ascending: false })
          .limit(1);
        const row = error ? undefined : ((data ?? []) as { key: string; body: ReviewDoc }[])[0];
        if (row) out.set(job, row.body);
      } catch {
        // No review shown for this job.
      }
    }),
  );
  return out;
}

/**
 * The review to show beside a job's last run: the last run's own, else the job's newest (marked `ofLastRun: false`, so
 * the page says which run it read). Pure.
 */
export function reviewForLastRun(job: string, lastRef: string | null, byKey: ReadonlyMap<string, ReviewDoc>, latest: ReadonlyMap<string, ReviewDoc>): { review: ReviewDoc; ofLastRun: boolean } | null {
  const own = lastRef ? byKey.get(reviewKey(job, lastRef)) : undefined;
  if (own) return { review: own, ofLastRun: true };
  const newest = latest.get(job);
  return newest ? { review: newest, ofLastRun: lastRef !== null && newest.run_ref === lastRef } : null;
}
