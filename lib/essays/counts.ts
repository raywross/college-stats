/**
 * The Essays tab's counts (specs/product/essays/tab.md; editors.md "Where it shows"), pure over rows the caller read:
 * open comments per draft, open suggestions per draft, and a guardian's own newest suggestion's state per draft. The
 * plan loader reads the rows by student in its first wave (lib/planner/read-plan.ts readPlanEssays), so the tab counts
 * them without another read (lib/essays/tab-data.ts); readEssays (lib/essays/load.ts) counts the rows it reads by id.
 * Pure: safe in tests.
 */
import type { ViewerRole } from "../viewer-relation.ts";

/** An open (unresolved) comment, as the counts read it. */
export interface OpenCommentRow {
  essay_id: string;
  resolved_at?: string | null;
}

/** A suggestion, as the counts read it (the reads ask for newest first, withdrawn ones left out). */
export interface SuggestionCountRow {
  essay_id: string;
  author_id: string | null;
  status: "open" | "decided" | "withdrawn";
  created: string;
}

/** Open suggestions per draft, and a guardian's own newest suggestion's state per draft (editors.md "Where it shows"). */
export interface SuggestionCounts {
  openSuggestions: Record<string, number>;
  mySuggestions: Record<string, "open" | "decided">;
}

/** Open (unresolved) comments per draft; a resolved row, if one is passed, isn't counted. */
export function openCommentCounts(rows: readonly OpenCommentRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of rows) if (!c.resolved_at) out[c.essay_id] = (out[c.essay_id] ?? 0) + 1;
  return out;
}

/**
 * How many suggestions are open on each draft, and for a guardian or a counselor (`userId` given) the state of their
 * own newest suggestion on each, withdrawn ones skipped. `rows` are newest first (the reads order them so), so the
 * first of a viewer's rows on a draft is their newest.
 */
export function suggestionCounts(rows: readonly SuggestionCountRow[], viewer: { role: ViewerRole; userId?: string | null }): SuggestionCounts {
  const out: SuggestionCounts = { openSuggestions: {}, mySuggestions: {} };
  for (const s of rows) {
    if (s.status === "withdrawn") continue;
    if (s.status === "open") out.openSuggestions[s.essay_id] = (out.openSuggestions[s.essay_id] ?? 0) + 1;
    if (viewer.role !== "student" && viewer.userId && s.author_id === viewer.userId && !out.mySuggestions[s.essay_id]) out.mySuggestions[s.essay_id] = s.status;
  }
  return out;
}
