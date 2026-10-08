/**
 * The `actions` generator (U4; specs/planner/actions.md): `follow` and `request_info`, undated, for every live
 * college while the plan is in season; `write_visit_notes` once for each past visit that still has no notes.
 *
 * Contract (lib/planner/tasks.ts): pure, no I/O; return every task this module wants to exist right now, each with a
 * key from taskKey() (`{item_id}:{kind}:{suffix}` for a college's task, `{list_id}:{kind}:{suffix}` for a
 * student-wide one). mergeTasks() keeps ticks, snoozes, and dismissals across runs and marks a task whose key stops
 * being generated as orphaned.
 */
import { hasVisitNotes } from "../actions.ts";
import { inSeason } from "../cycle.ts";
import { taskKey } from "../tasks.ts";
import type { GeneratedTask, GeneratorInput } from "../types.ts";

function followTask(itemId: string, name: string): GeneratedTask {
  return {
    key: taskKey(itemId, "follow"),
    item_id: itemId,
    kind: "follow",
    title: `Follow ${name}`,
    detail: "Admissions offices often post deadline changes and event dates on social first, before email.",
    due_on: null,
    window_start: null,
    window_end: null,
    assignee: "student",
    source: "stage",
    source_field: null,
    source_edition: null,
    date_note: null,
    position: 0,
  };
}

function requestInfoTask(itemId: string, name: string): GeneratedTask {
  return {
    key: taskKey(itemId, "request_info"),
    item_id: itemId,
    kind: "request_info",
    title: `Request information from ${name}`,
    detail: "Use one email address for every college: admissions offices match interest records by it.",
    due_on: null,
    window_start: null,
    window_end: null,
    assignee: "student",
    source: "stage",
    source_field: null,
    source_edition: null,
    date_note: null,
    position: 0,
  };
}

function writeVisitNotesTask(itemId: string, visitId: string, name: string | null): GeneratedTask {
  return {
    key: taskKey(itemId, "write_visit_notes", visitId),
    item_id: itemId,
    kind: "write_visit_notes",
    title: name ? `Write down what you thought about ${name}` : "Write down what you thought about your visit",
    detail: "While it's fresh: what stood out, what worried you, who you met.",
    due_on: null,
    window_start: null,
    window_end: null,
    assignee: "student",
    source: "stage",
    source_field: null,
    source_edition: null,
    date_note: null,
    position: 0,
  };
}

export function generate(input: GeneratorInput): GeneratedTask[] {
  const out: GeneratedTask[] = [];

  if (inSeason(input.grade)) {
    for (const item of input.items) {
      // Once a decision's in or the application's withdrawn, following and asking for information no longer help.
      if (item.status === "decided" || item.withdrawn_on) continue;
      const school = input.schools[item.unit_id];
      if (!school) continue;
      const hasAccounts = Boolean(school.social && Object.keys(school.social as Record<string, unknown>).length > 0);
      if (hasAccounts && (item.followed_networks?.length ?? 0) === 0) out.push(followTask(item.id, school.name));
      if (!item.info_requested_on) out.push(requestInfoTask(item.id, school.name));
    }
  }

  for (const visit of input.visits) {
    if (visit.on_date > input.today) continue; // only a past visit gets the prompt
    if (hasVisitNotes(visit.notes)) continue;
    const item = input.items.find((i) => i.id === visit.item_id);
    const school = item ? input.schools[item.unit_id] : undefined;
    out.push(writeVisitNotesTask(visit.item_id, visit.id, school?.name ?? null));
  }

  return out;
}
