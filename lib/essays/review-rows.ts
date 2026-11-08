/**
 * A reader's stored notes as the notes panel gets them (specs/product/essays/reviewer.md; components/essays/Notes.tsx):
 * the review rows and their note rows shaped into `StoredReview`s. One shaping for both ways they arrive, so the two
 * build identical objects: the review route's GET reads the tables (app/api/essays/review/route.ts readReviews), the
 * essay page reads them in essay_bundle() (lib/essays/load.ts readEssay; specs/serving-architecture.md) and hands them
 * to the panel, which then skips its fetch.
 *
 * Pure (type-only imports): tests run it directly (tests/essay-page-waves.test.mts).
 */
import type { StoredReview } from "./review.ts";

export type NoteRow = {
  id: string;
  review_id: string;
  position: number;
  category: StoredReview["notes"][number]["category"];
  span: StoredReview["notes"][number]["span"];
  observation: string;
  why: string;
  source: string | null;
  ask: string;
  fix: string | null;
  state: "open" | "done" | "ignored";
};
export type ReviewRow = { id: string; version_id: string; created: string; outcome: StoredReview["outcome"]; method: string };

export const NOTE_COLUMNS = "id, review_id, position, category, span, observation, why, source, ask, fix, state";
export const REVIEW_COLUMNS = "id, version_id, created, outcome, method";

/** Each review (in the order given: newest first) with its notes by position; the note's review id and position drop. */
export function assemble(reviews: ReviewRow[], notes: NoteRow[]): StoredReview[] {
  return reviews.map(({ id, version_id, created, outcome, method }) => ({
    id,
    version_id,
    created,
    outcome,
    method,
    notes: notes
      .filter((n) => n.review_id === id)
      .sort((a, b) => a.position - b.position)
      .map(({ id, category, span, observation, why, source, ask, fix, state }) => ({ id, category, span, observation, why, source, ask, fix, state })),
  }));
}

/** essay_bundle()'s `reviews` (each with its notes nested, carrying review_id and position) through the same shaping. */
export function reviewsFromBundle(reviews: (ReviewRow & { notes: NoteRow[] | null })[] | null | undefined): StoredReview[] {
  const rows = reviews ?? [];
  return assemble(
    rows,
    rows.flatMap((r) => r.notes ?? []),
  );
}
