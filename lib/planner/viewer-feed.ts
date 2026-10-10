/**
 * The per-viewer calendar feed's events (specs/planner/redesign/calendar.md "Feed, print, share"): one feed for a
 * person that carries every child they can see, each event's title starting with the child's first name ("Maya:
 * Wake Forest, apply (ED I)"). Pure; the route (app/api/plan/feed/[token]/route.ts) reads the rows with
 * plan_viewer_feed() and resolves college names from the dataset.
 *
 * The built feed's rule holds (specs/planner/timeline.md "Display"): titles and dates only, never a detail, a note,
 * or a number from the profile. Titles go through the timeline's scrubNumbers, as the per-list feed's do.
 */
import type { IcsEvent } from "../ics.ts";
import { dayLabel } from "./calendar.ts";
import { scrubNumbers, VISIT_LABELS } from "./timeline.ts";
import type { VisitKind } from "./types.ts";

/** One row of plan_viewer_feed() (supabase/migrations/20261010130000_plan_viewer_feed.sql). */
export interface ViewerFeedRow {
  student_id: string;
  student_name: string | null;
  kind: "task" | "visit";
  id: string;
  item_id: string | null;
  unit_id: string | null;
  round: string | null;
  title: string | null;
  due_on: string | null;
  window_start: string | null;
  window_end: string | null;
  visit_kind: string | null;
  at_time: string | null;
}

/** What a child is called in the feed: their first name, else "Student". */
export function feedChildName(name: string | null | undefined): string {
  return scrubNumbers(name?.trim().split(/\s+/)[0] ?? "") || "Student";
}

/**
 * One title: the child's name first, then the college and the task with its first letter lowered, or the task alone
 * when it isn't about one college. "Maya: Wake Forest, apply (ED I)", "Maya: Register for the SAT on Nov 7".
 */
export function viewerTitle(child: string, college: string | null, title: string): string {
  const plain = scrubNumbers(title);
  if (!college) return `${child}: ${plain}`;
  const lowered = /^[A-Z][a-z]/.test(plain) ? plain[0].toLowerCase() + plain.slice(1) : plain;
  return `${child}: ${college}, ${lowered}`;
}

/**
 * The feed's events from the rows: dated tasks, windows from their start ("until Aug 31"), and visits at their time.
 * `collegeName` maps a unit id to the college's name (the dataset); an unknown one reads "A college".
 */
export function viewerFeedEvents(rows: ViewerFeedRow[], collegeName: (unitId: string) => string | null, domain = "quad.plan"): IcsEvent[] {
  const events: IcsEvent[] = [];
  for (const r of rows) {
    const child = feedChildName(r.student_name);
    const college = r.unit_id ? (collegeName(r.unit_id) ?? "A college") : null;
    if (r.kind === "visit") {
      if (!r.due_on) continue;
      const label = VISIT_LABELS[r.visit_kind as VisitKind] ?? "visit";
      events.push({ uid: `viewer-visit-${r.id}@${domain}`, date: r.due_on, time: r.at_time, minutes: 90, summary: `${child}: ${college ?? "A college"} ${label}` });
      continue;
    }
    if (!r.title) continue;
    const summary = viewerTitle(child, college, r.title);
    if (r.due_on) events.push({ uid: `viewer-task-${r.id}@${domain}`, date: r.due_on, summary });
    else if (r.window_start && r.window_end) {
      events.push({ uid: `viewer-task-${r.id}@${domain}`, date: r.window_start, summary: `${summary} (until ${dayLabel(r.window_end)})` });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary));
}
