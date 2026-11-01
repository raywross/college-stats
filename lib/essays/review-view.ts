/**
 * What Suggest changes and Review changes show (specs/product/essays/editors.md "1. Suggestions", "The reader's
 * fixes"): the words on screen, which suggestions are still open, each editor's changes against the current text, the
 * reader's mechanics fixes as changes of their own, the marks the open changes draw in the field, and the rendering
 * cut into paragraphs. components/essays/{Editor,ReviewChanges,SuggestBox}.tsx read these.
 *
 * Pure; safe in server code, client components, and tests.
 */
import { changeLine, commentAuthorKey, READER_KEY, READER_LABEL, type MarkItem } from "./marks.ts";
import { spanOffsets, type NoteSpan } from "./notes-view.ts";
import { changesBetween, statusAfter, type Change, type ChangeView, type Decision, type Located, type Segment, type SuggestionRow } from "./suggestions.ts";

export type SuggestionView = SuggestionRow & { author_name: string | null };

/** The role's word when the editor's name isn't known. */
const ROLE_WORD: Record<SuggestionRow["author_role"], string> = {
  guardian: "Parent",
  counselor: "Counselor",
};
/** The same, opening a sentence ("A parent suggested 3 changes"). */
const ROLE_SUBJECT: Record<SuggestionRow["author_role"], string> = {
  guardian: "A parent",
  counselor: "A counselor",
};

const firstName = (name: string | null | undefined): string | null => name?.trim().split(/\s+/)[0] || null;

/** An editor's chip and line label: their first name, else the role word. */
export function editorLabel(s: Pick<SuggestionView, "author_name" | "author_role">): string {
  return firstName(s.author_name) ?? ROLE_WORD[s.author_role];
}

/** The author key a suggestion's color comes from (the same key as the author's comments). */
export function suggestionAuthorKey(s: Pick<SuggestionRow, "author_id" | "author_role">): string {
  return commentAuthorKey(s);
}

/** "1 change", "3 changes". */
export const changesWord = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

/** The student's banner line for one editor: "Jane suggested 3 changes". */
export function bannerLine(s: Pick<SuggestionView, "author_name" | "author_role">, n: number): string {
  return `${firstName(s.author_name) ?? ROLE_SUBJECT[s.author_role]} suggested ${changesWord(n)}`;
}

/** The one-line confirmation of Accept all / Reject all, naming the editor and the count. */
export function confirmLine(action: "accept" | "reject", name: string, n: number): string {
  const verb = action === "accept" ? "Accept" : "Reject";
  return n === 1 ? `${verb} the 1 change from ${name}?` : `${verb} all ${n} changes from ${name}?`;
}

/** An editor's line while the student hasn't decided: "Waiting for Alice". */
export function waitingLine(studentFirst: string | null): string {
  return `Waiting for ${firstName(studentFirst) ?? "the student"}`;
}

/** The decisions as the page knows them: the stored ones with this page's own decisions laid over. */
export function mergedDecisions(s: Pick<SuggestionRow, "id" | "decisions">, local: Record<string, Record<string, Decision>>): Record<string, Decision> {
  return { ...(s.decisions ?? {}), ...(local[s.id] ?? {}) };
}

/** A suggestion with its changes computed once (from its base, never the current text) and its decisions. */
export interface SuggestionChanges {
  suggestion: SuggestionView;
  changes: Change[];
  decisions: Record<string, Decision>;
}

/**
 * The suggestions still open, oldest first (the order their authors got their colors), each with its changes and
 * decisions; one whose every change this page has decided is left out (the refresh confirms it).
 */
export function openSuggestions(suggestions: readonly SuggestionView[], local: Record<string, Record<string, Decision>> = {}): SuggestionChanges[] {
  return suggestions
    .filter((s) => s.status === "open")
    .map((s) => ({
      suggestion: s,
      changes: changesBetween(s.base_body, s.proposed_body),
      decisions: mergedDecisions(s, local),
    }))
    .filter((x) => x.changes.length > 0 && statusAfter(x.changes, x.decisions) === "open")
    .sort((a, b) => a.suggestion.created.localeCompare(b.suggestion.created) || a.suggestion.id.localeCompare(b.suggestion.id));
}

/** The changes no decision has reached. */
export const undecided = (x: Pick<SuggestionChanges, "changes" | "decisions">): Change[] => x.changes.filter((c) => !x.decisions[c.key]);

/** Each change against the current text: an undecided change where it sits now (null: stale); a decided one, unplaced. */
export function placeChanges(current: string, changes: readonly Change[], decisions: Record<string, Decision>, locate: (t: string, c: Change) => Located | null): ChangeView[] {
  return changes.map((c) => {
    const decision = decisions[c.key] ?? null;
    return {
      ...c,
      decision,
      located: decision === null ? locate(current, c) : null,
    };
  });
}

/** A mechanics note of the newest read with a corrected word (reviewer.md "What a note is", `fix`). */
export interface ReaderFix {
  noteId: string;
  span: NoteSpan;
  fix: string;
  observation: string;
}

/** The newest read's open mechanics notes that carry a fix and a span. Nothing else from the reader is a change. */
export function readerFixes(
  notes: readonly {
    id: string;
    category: string;
    span: NoteSpan | null;
    fix: string | null;
    state: string;
    observation: string;
  }[],
): ReaderFix[] {
  return notes
    .filter((n) => n.category === "mechanics" && n.state === "open" && n.span && n.fix && n.fix.trim() && !n.id.startsWith("streamed-"))
    .map((n) => ({
      noteId: n.id,
      span: n.span!,
      fix: n.fix!,
      observation: n.observation,
    }));
}

/** The reader's fixes as changes in the current text: the words at the note's span out, the fix in (keyed by note id). */
export function fixChanges(current: string, fixes: readonly ReaderFix[]): ChangeView[] {
  return fixes.map((f) => {
    const at = spanOffsets(current, f.span);
    return {
      key: f.noteId,
      removed: at ? current.slice(at.start, at.end) : "",
      inserted: f.fix,
      before: "",
      after: "",
      decision: null,
      located: at,
    };
  });
}

/** The text with each open placed change applied at its offsets, from the end (the reader's fixes' "As suggested"). */
export function applyPlaced(current: string, changes: readonly ChangeView[]): string {
  const open = changes.filter((c): c is ChangeView & { located: Located } => c.decision === null && c.located !== null).sort((a, b) => b.located.start - a.located.start);
  let text = current;
  let floor = Infinity;
  for (const c of open) {
    if (c.located.end > floor) continue;
    text = text.slice(0, c.located.start) + c.inserted + text.slice(c.located.end);
    floor = c.located.start;
  }
  return text;
}

/** One editor in Review changes: a suggestion's author, or the reader with its fixes. */
export interface ReviewEditor {
  /** The suggestion's id, or "reader". */
  id: string;
  kind: "suggestion" | "reader";
  /** The color's key. */
  authorKey: string;
  label: string;
  note: string | null;
  changes: ChangeView[];
}

/** Review changes' chips, in order: each open suggestion's author (oldest first), then the reader's fixes when there are any. */
export function reviewEditors(current: string, open: readonly SuggestionChanges[], fixes: readonly ReaderFix[], locate: (t: string, c: Change) => Located | null): ReviewEditor[] {
  const out: ReviewEditor[] = open.map((x) => ({
    id: x.suggestion.id,
    kind: "suggestion",
    authorKey: suggestionAuthorKey(x.suggestion),
    label: editorLabel(x.suggestion),
    note: x.suggestion.note,
    changes: placeChanges(current, x.changes, x.decisions, locate),
  }));
  if (fixes.length > 0)
    out.push({
      id: READER_KEY,
      kind: "reader",
      authorKey: READER_KEY,
      label: READER_LABEL,
      note: null,
      changes: fixChanges(current, fixes),
    });
  return out;
}

/** Whether the student's page shows the Write and Review changes tabs: an open suggestion or a reader's fix. */
export const showsReviewTabs = (open: readonly SuggestionChanges[], fixes: readonly ReaderFix[]) => open.length > 0 || fixes.length > 0;

/** The Review changes tab's badge: every change still to decide, the reader's fixes included. */
export const reviewCount = (open: readonly SuggestionChanges[], fixes: readonly ReaderFix[]) => open.reduce((n, x) => n + undecided(x).length, 0) + fixes.length;

/** The open changes an editor's suggestion draws in the field, under the author's color (Marks.tsx locates them). */
export function changeMarks(x: SuggestionChanges, label: string): MarkItem[] {
  const authorKey = suggestionAuthorKey(x.suggestion);
  return undecided(x).map((c) => ({
    id: `change-${c.key}`,
    kind: "change" as const,
    authorKey,
    label,
    firstLine: changeLine(c),
    targetId: `change-${c.key}`,
    change: c,
  }));
}

/** A paragraph of the "With changes" rendering: its segments (a change's words may hold a line break; they stay whole). */
export type SegmentBlock = Segment[];

/** The segments cut into paragraphs at the line breaks of the unchanged text; an empty line is an empty block. */
export function segmentBlocks(segments: readonly Segment[]): SegmentBlock[] {
  const blocks: SegmentBlock[] = [[]];
  for (const seg of segments) {
    if (seg.kind !== "text") {
      blocks[blocks.length - 1].push(seg);
      continue;
    }
    const lines = seg.text.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) blocks.push([]);
      if (line) blocks[blocks.length - 1].push({ kind: "text", text: line });
    });
  }
  return blocks;
}

/** The changes that no longer fit the current text ("The draft changed here"), still undecided. */
export const staleOf = (changes: readonly ChangeView[]) => changes.filter((c) => c.decision === null && c.located === null);

/** The open changes that sit in the text (what Accept all accepts). */
export const placedOf = (changes: readonly ChangeView[]) => changes.filter((c) => c.decision === null && c.located !== null);

/** The localStorage key of an editor's unsent suggestion on a draft. */
export const suggestKey = (essayId: string, userId: string) => `quad.essay.${essayId}.suggest.${userId}`;
