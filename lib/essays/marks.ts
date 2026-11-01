/**
 * Marks in the draft (specs/product/essays/editors.md "2. Marks in the draft"): the spans that the reader's notes,
 * the comments and the open suggestions point at, resolved against the field's live text, cut into non-overlapping
 * segments that carry every item on their words, the per-draft colors (the reader amber, the student gray, everyone
 * else from a fixed palette in order of first appearance), and the legend's entries. components/essays/Marks.tsx
 * draws them. Pure; safe in server code, client components, and tests.
 */
import { spanOffsets, type NoteSpan } from "./notes-view.ts";

/**
 * A suggested change, as lib/essays/suggestions.ts defines it (the same shape; declared here because that module is
 * built alongside this one: once both are on one branch this becomes `import type { Change } from "./suggestions"`).
 */
export interface Change {
  key: string;
  removed: string;
  inserted: string;
  before: string;
  after: string;
}
/** Where a change sits in the current text (start === end for a pure insertion), or null when the draft changed there. */
export type ChangeLocator = (current: string, change: Change) => { start: number; end: number } | null;

export type MarkKind = "note" | "comment" | "change";
export type MarkColor = "amber" | "gray" | "blue" | "violet" | "green" | "rose" | "teal";

export interface MarkItem {
  id: string;
  kind: MarkKind;
  /** "reader" for the reader's notes, "student" for the student's own comments, else the author's user id. */
  authorKey: string;
  /** "Reader's notes", the author's first name, "You". */
  label: string;
  /** The note's observation, the comment's first 80 characters, "Suggests: {inserted}" / "Suggests removing: {removed}". */
  firstLine: string;
  /** The DOM id of the item's card: `note-<id>`, `comment-<id>`, `change-<key>`. */
  targetId: string;
  /** Notes and comments: resolved against the live text with spanOffsets. */
  span?: NoteSpan;
  /** Open changes: resolved with the change locator. */
  change?: Change;
}

export interface Resolved {
  item: MarkItem;
  start: number;
  end: number;
}
/** Non-overlapping, in text order; an insertion-only change is a zero-width segment (start === end). */
export interface MarkSegment {
  start: number;
  end: number;
  items: MarkItem[];
}

export const READER_KEY = "reader";
export const STUDENT_KEY = "student";
export const READER_LABEL = "Reader's notes";

/**
 * Every item that still resolves in `text`, with its absolute offsets: a span through spanOffsets, a change through
 * `locate` (lib/essays/suggestions.ts's locateChange; without one, changes don't draw). Items that no longer fit
 * (the paragraph is gone or shorter, the words were rewritten) drop out, in the order given.
 */
export function resolveMarks(text: string, items: readonly MarkItem[], locate?: ChangeLocator): Resolved[] {
  const out: Resolved[] = [];
  for (const item of items) {
    let at: { start: number; end: number } | null = null;
    if (item.span) at = spanOffsets(text, item.span);
    else if (item.change && locate) at = locate(text, item.change);
    if (!at || at.start < 0 || at.end > text.length || at.end < at.start) continue;
    // A span always covers words; only a change may be zero-width (an insertion).
    if (at.end === at.start && !item.change) continue;
    out.push({ item, start: at.start, end: at.end });
  }
  return out;
}

/**
 * The resolved items cut into segments: every boundary of every range splits the text, and each piece carries the
 * items that cover it (in the order given), so two marks on the same words both show. A zero-width item makes its
 * own segment at its offset, splitting a range it falls inside; it comes after a range that ends there and before
 * one that starts there.
 */
export function segmentMarks(resolved: readonly Resolved[]): MarkSegment[] {
  const ranges = resolved.filter((r) => r.end > r.start);
  const points = [...resolved.map((r) => r.start)];
  for (const r of ranges) points.push(r.end);
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  const out: MarkSegment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const carets = resolved.filter((r) => r.end === r.start && r.start === p).map((r) => r.item);
    if (carets.length > 0) out.push({ start: p, end: p, items: carets });
    const next = sorted[i + 1];
    if (next === undefined) break;
    const covering = ranges.filter((r) => r.start <= p && r.end >= next).map((r) => r.item);
    if (covering.length > 0) out.push({ start: p, end: next, items: covering });
  }
  return out;
}

/** The palette for everyone but the reader and the student, in order of first appearance, repeating after five. */
export const PALETTE: readonly MarkColor[] = ["blue", "violet", "green", "rose", "teal"];

/**
 * Each author key's color: "reader" amber, "student" gray, every other key the next palette color in the order
 * given (first appearance by created time on this draft), repeating after five. Duplicates keep their first color.
 */
export function assignColors(order: readonly string[]): Record<string, MarkColor> {
  const out: Record<string, MarkColor> = {};
  let next = 0;
  for (const key of order) {
    if (key in out) continue;
    if (key === READER_KEY) out[key] = "amber";
    else if (key === STUDENT_KEY) out[key] = "gray";
    else out[key] = PALETTE[next++ % PALETTE.length];
  }
  return out;
}

/**
 * The order of author keys for assignColors: each key at its earliest `created`, earliest first (ties by key, so the
 * order never depends on the rows' order). The page passes comments' authors; suggestions' authors join the same list.
 */
export function authorOrder(rows: readonly { key: string; created: string }[]): string[] {
  const first = new Map<string, string>();
  for (const r of rows) {
    const had = first.get(r.key);
    if (had === undefined || r.created < had) first.set(r.key, r.created);
  }
  return [...first.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([k]) => k);
}

/** A comment's author key: "student" for the student's own (gray for everyone), else the author's id. */
export function commentAuthorKey(c: { author_id: string | null; author_role: "student" | "guardian" | "counselor" }): string {
  if (c.author_role === "student") return STUDENT_KEY;
  return c.author_id ?? `former-${c.author_role}`;
}

/** The first `max` characters of a text on one line, with an ellipsis when cut. */
export function firstLineOf(text: string, max = 80): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max).trimEnd()}…`;
}

/** A change's popover line: the words it puts in, or the words it takes out when it only removes. */
export function changeLine(change: Pick<Change, "removed" | "inserted">): string {
  return change.inserted.trim() ? `Suggests: ${firstLineOf(change.inserted)}` : `Suggests removing: ${firstLineOf(change.removed)}`;
}

export interface LegendEntry {
  key: string;
  label: string;
  color: MarkColor;
  count: number;
}

/**
 * The legend: one entry per author key among the items, with its label (the first item's), color and count. In the
 * colors' order (the order of first appearance), then any key without a color in the items' order (shown gray).
 */
export function legendFor(items: readonly MarkItem[], colors: Record<string, MarkColor>): LegendEntry[] {
  const byKey = new Map<string, LegendEntry>();
  for (const it of items) {
    const e = byKey.get(it.authorKey);
    if (e) e.count++;
    else byKey.set(it.authorKey, { key: it.authorKey, label: it.label, color: colors[it.authorKey] ?? "gray", count: 1 });
  }
  const ordered = Object.keys(colors).filter((k) => byKey.has(k));
  const rest = [...byKey.keys()].filter((k) => !(k in colors));
  return [...ordered, ...rest].map((k) => byKey.get(k)!);
}
