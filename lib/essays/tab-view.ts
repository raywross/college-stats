/**
 * The Essays tab's words (specs/product/essays/tab.md "The screen"), pure: each college card's heading and status, a
 * prompt row's title and state, "also used for", and the lines for a college whose prompts aren't on file. Built on
 * `essayProgress` (lib/essays/progress.ts) so the tab and the essays move never disagree. No essay text: titles,
 * counts, and statuses only (a prompt's own first words, as the picker shows them, are the college's, not the
 * student's). Pure; safe in server code, client components, and tests.
 */
import { countLabel } from "./count.ts";
import { handReadLine } from "../essay-prompts/confirmed.ts";
import { KIND_LABEL, refUnitId, type EssayKind, type PickerGroup } from "./prompts.ts";
import { refsOf, type EssayLinkRow, type EssayRow } from "./rows.ts";
import type { CollegeEssayProgress, PromptProgress, PromptState } from "./progress.ts";
import type { ListRound } from "../list-rules.ts";

/** What app/advisor/page.tsx reads for the tab (lib/essays/tab-data.ts). Serializable. */
export interface EssaysTabData {
  kind: "ready" | "setup-missing";
  rows: EssayRow[];
  links: EssayLinkRow[];
  /** Open comments per draft id. */
  openComments: Record<string, number>;
  /** Open suggestions per draft id (editors.md "Where it shows": "2 suggestions", for the student). */
  openSuggestions?: Record<string, number>;
  /** A guardian's own newest suggestion's state per draft id ("Waiting for {first}" while open). */
  mySuggestions?: Record<string, "open" | "decided">;
  /** The prompt picker's groups (lib/essays/prompts.ts pickerGroups over the plan's colleges). */
  picker: PickerGroup[];
  /** Every college a draft is written for, on the plan or not, by unit id. */
  collegeNames: Record<string, string>;
}

/** The state glyphs (tab.md: ○ not started, ◐ draft, ● ready). */
export const GLYPH: Record<PromptState, string> = { not_started: "○", draft: "◐", ready: "●" };
export const STATE_WORD: Record<PromptState, string> = { not_started: "Not started", draft: "Draft", ready: "Ready" };

const ROUND_WORD: Record<ListRound, string> = { ed: "ED", ed2: "ED II", ea: "EA", rea: "REA", rd: "RD", rolling: "rolling" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** "Duke · ED · by Nov 1", "Elon · rolling", "Yale · RD · by Jan 2", or the name alone. */
export function collegeHeading(c: Pick<CollegeEssayProgress, "name" | "round" | "deadline">): string {
  const parts = [c.name];
  if (c.round) parts.push(ROUND_WORD[c.round]);
  if (c.deadline) parts.push(`by ${dayLabel(c.deadline)}`);
  return parts.join(" · ");
}

/** The card's right side: "2 of 3 ready", "prompts not on file", "no essays beyond the Common App's". */
export function collegeStatus(c: Pick<CollegeEssayProgress, "onFile" | "ready" | "total" | "own">): string {
  if (c.onFile === "not_on_file" && c.own.length === 0) return "prompts not on file";
  if (c.onFile === "none" && c.own.length === 0) return "no essays beyond the Common App's";
  if (c.onFile === "refers_to_form" && c.own.length === 0) return "asks in the application";
  return `${c.ready} of ${c.total} ready`;
}

/** Every prompt on the card is ready (and there was at least one). */
export const collegeDone = (c: Pick<CollegeEssayProgress, "ready" | "total">) => c.total > 0 && c.ready >= c.total;

/**
 * The line under a card: where a hand-read college's prompts came from (sources.md §3, "From the application form,
 * read by hand on {date}"), or why a college's prompts can't be listed (tab.md "A college not on file"; the
 * `refers_to_form` line as sources.md §3 rewords it), or null.
 */
export function collegeNote(c: Pick<CollegeEssayProgress, "onFile" | "name" | "confirmedOn">): string | null {
  if (c.confirmedOn) return `${handReadLine(c.confirmedOn)}.`;
  if (c.onFile === "not_on_file") return `We haven't read ${c.name}'s essay page yet. ${c.name}'s own site has it.`;
  if (c.onFile === "refers_to_form") return `${c.name} doesn't publish its questions on its site; they're inside the application. Add each one here as you meet it.`;
  return null;
}

/** Whether anything on the card has a draft (the Package link shows from then on). */
export function anyStarted(c: Pick<CollegeEssayProgress, "required" | "optional" | "own">): boolean {
  return c.own.length > 0 || [...c.required, ...c.optional].some((p) => p.essayId !== null);
}

/** Kinds whose label alone says little; their row adds the prompt's first words, as the picker shows the prompt. */
const VAGUE: ReadonlySet<EssayKind> = new Set(["essay", "short_answer", "optional", "other"]);

/** The prompt's first `n` words with an ellipsis ("Tell us about a time…"); the whole prompt when it's that short. */
export function firstWords(text: string, n = 5): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= n) return words.join(" ");
  return `${words.slice(0, n).join(" ").replace(/[,;:.]$/, "")}…`;
}

/** A prompt row's title: "Why us (250 words)", or for a vague kind "Short answer (150 words) · “Tell us about…”". */
export function promptTitle(p: Pick<PromptProgress, "kind" | "limit">, text: string | null): string {
  const limit = p.limit ? ` (${countLabel(p.limit.max, null, p.limit.kind)})` : "";
  const base = `${KIND_LABEL[p.kind]}${limit}`;
  return VAGUE.has(p.kind) && text ? `${base} · “${firstWords(text)}”` : base;
}

/** The row's right side: "Ready", "Draft · 180 of 250 words", or null (not started: the row shows Start). */
export function stateLine(p: Pick<PromptProgress, "state" | "count" | "limit">): string | null {
  if (p.state === "not_started") return null;
  if (p.state === "ready") return STATE_WORD.ready;
  return `Draft · ${countLabel(p.count ?? 0, p.limit ?? null, p.limit?.kind ?? "words")}`;
}

/**
 * For each draft, the colleges whose prompts it serves (its own and its links), by unit id and name: the card for
 * one college shows the others as "also used for {College}" (tab.md "A draft that serves several prompts").
 */
export function collegesByEssay(rows: readonly EssayRow[], links: readonly EssayLinkRow[], names: Record<string, string>): Record<string, { unit_id: string; name: string }[]> {
  const out: Record<string, { unit_id: string; name: string }[]> = {};
  for (const e of rows) {
    const units = [...new Set(refsOf(e, links).flatMap((r) => refUnitId(r) ?? []))];
    out[e.id] = units.map((u) => ({ unit_id: u, name: names[u] ?? "A college" }));
  }
  return out;
}

/**
 * Beside the open-comment count (tab.md "Where it shows": "a row with open suggestions shows '2 suggestions' beside
 * its open-comment count, for the student; for an editor, 'Waiting for {first}' on rows with their own open
 * suggestion"): "2 suggestions"/"1 suggestion" for the student when the draft has any open; "Waiting for {first}"
 * for a guardian whose own newest suggestion on that draft is still open. Null when neither applies.
 */
export function suggestionNote(viewer: "student" | "guardian", open: number, mine: "open" | "decided" | undefined, studentFirst: string | null): string | null {
  if (viewer === "guardian") return mine === "open" ? `Waiting for ${studentFirst ?? "the student"}` : null;
  return open > 0 ? `${open} ${open === 1 ? "suggestion" : "suggestions"}` : null;
}

/** "also used for Michigan and Rice", or null when the draft serves this college alone. */
export function alsoUsedFor(byEssay: Record<string, { unit_id: string; name: string }[]>, essayId: string | null, unitId: string): string | null {
  if (!essayId) return null;
  const others = (byEssay[essayId] ?? []).filter((c) => c.unit_id !== unitId).map((c) => c.name);
  if (others.length === 0) return null;
  return `also used for ${new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(others)}`;
}

/** The editor's address, with the guardian's child. */
export const editorHref = (id: string, person: string | null) => `/advisor/essays/${id}${person ? `?for=${person}` : ""}`;
/** The package page's address, with the guardian's child. */
export const packageHref = (unitId: string, person: string | null) => `/advisor/essays/package/${unitId}${person ? `?for=${person}` : ""}`;
