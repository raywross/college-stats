/**
 * One draft as the essay page reads it (specs/product/essays/workspace.md "Where it lives"; lib/essays/load.ts
 * readEssay): from essay_bundle() in one call (supabase/migrations/20261108130000_essay_and_me_bundles.sql), or, while
 * that function isn't installed, table by table as before. Both build the same `EssayRead`.
 *
 * Pure (the client and the name lookup are passed in; type-only imports), so tests compare the two paths with a fake
 * client (tests/essay-page-waves.test.mts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EssayBundle } from "../bundle-read.ts";
import type { StoredReview } from "./review.ts";
import { reviewsFromBundle } from "./review-rows.ts";
import type { CommentRow, EssayLinkRow, EssayRow, VersionRow } from "./rows.ts";
import type { SuggestionRow } from "./suggestions.ts";

export const ESSAY_LIST_COLUMNS = "id, student_id, prompt_ref, title, count_kind, count, limit_max, limit_min, status, kind, base_id, created, updated";
export const ESSAY_COLUMNS = `${ESSAY_LIST_COLUMNS}, body`;
export const SUGGESTION_COLUMNS = "id, essay_id, base_version_id, base_body, author_id, author_role, proposed_body, note, status, decisions, created, updated, decided_at";

/** The table isn't there yet (the migration not applied). */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? ""));
}

export type EssayRead =
  | {
      kind: "ready";
      essay: EssayRow & { body: string };
      versions: VersionRow[];
      links: EssayLinkRow[];
      comments: (CommentRow & { author_name: string | null })[];
      /** Every suggestion not withdrawn, newest first (editors.md "The model"). */
      suggestions: (SuggestionRow & { author_name: string | null })[];
      base: { id: string; title: string; updated: string } | null;
      variants: number;
      /**
       * From the bundle only: the draft's reviews (newest first, at most 10), shaped as the review route's GET answers
       * them, so the notes panel starts with them instead of fetching (components/essays/Notes.tsx `initial`).
       */
      reviews?: StoredReview[];
      /** From the bundle only: the unit ids on the student's default list, by position (planColleges maps them). */
      list_unit_ids?: string[];
    }
  | { kind: "not-found" }
  | { kind: "setup-missing" };

/** essay_bundle()'s answer as an EssayRead (the function already named the authors and dropped withdrawn suggestions). */
export function essayReadFromBundle(b: EssayBundle): EssayRead {
  return {
    kind: "ready",
    essay: b.essay,
    versions: b.versions ?? [],
    links: b.links ?? [],
    comments: b.comments ?? [],
    suggestions: (b.suggestions ?? []).map((s) => ({ ...s, decisions: s.decisions ?? {} })),
    base: b.base ?? null,
    variants: b.variants ?? 0,
    reviews: reviewsFromBundle(b.reviews),
    list_unit_ids: b.list_unit_ids ?? [],
  };
}

/**
 * The per-table reads (the fallback): the essay row, then its versions (newest first, at most 100), links, comments
 * (oldest first), suggestions not withdrawn (newest first), base, and variant count together, then the authors' names.
 */
export async function readEssayTables(supabase: SupabaseClient, id: string, namesFor: (userIds: string[]) => Promise<Record<string, string | null>>): Promise<EssayRead> {
  const essay = await supabase.from("essays").select(ESSAY_COLUMNS).eq("id", id).maybeSingle();
  if (essay.error) {
    if (isMissingTable(essay.error)) return { kind: "setup-missing" };
    throw new Error(`Reading the draft failed: ${essay.error.message}`);
  }
  if (!essay.data) return { kind: "not-found" };
  const row = essay.data as EssayRow & { body: string };
  const [versions, links, comments, suggestions, base, variants] = await Promise.all([
    supabase.from("essay_versions").select("id, essay_id, count, source, label, created").eq("essay_id", id).order("created", { ascending: false }).limit(100),
    supabase.from("essay_links").select("essay_id, prompt_ref, created").eq("essay_id", id),
    supabase.from("essay_comments").select("id, essay_id, version_id, author_id, author_role, anchor, body, created, resolved_at").eq("essay_id", id).order("created"),
    supabase.from("essay_suggestions").select(SUGGESTION_COLUMNS).eq("essay_id", id).neq("status", "withdrawn").order("created", { ascending: false }),
    row.base_id ? supabase.from("essays").select("id, title, updated").eq("id", row.base_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("essays").select("id", { count: "exact", head: true }).eq("base_id", id),
  ]);
  const commentRows = (comments.data ?? []) as CommentRow[];
  // No suggestions table yet (the migration not applied): none, never a failed page.
  if (suggestions.error && !isMissingTable(suggestions.error)) console.error(`essays: reading suggestions failed: ${suggestions.error.message}`);
  const suggestionRows = (suggestions.error ? [] : (suggestions.data ?? [])) as SuggestionRow[];
  const names = await namesFor([...commentRows, ...suggestionRows].map((c) => c.author_id).filter((v): v is string => !!v));
  return {
    kind: "ready",
    essay: row,
    versions: (versions.data ?? []) as VersionRow[],
    links: (links.data ?? []) as EssayLinkRow[],
    comments: commentRows.map((c) => ({ ...c, author_name: c.author_id ? (names[c.author_id] ?? null) : null })),
    suggestions: suggestionRows.map((s) => ({ ...s, decisions: s.decisions ?? {}, author_name: s.author_id ? (names[s.author_id] ?? null) : null })),
    base: (base.data as { id: string; title: string; updated: string } | null) ?? null,
    variants: variants.count ?? 0,
  };
}
