/**
 * Suggested changes (specs/product/essays/editors.md "The changes: how they are computed, named, located and
 * applied"): an editor's proposed text, compared word by word with the text they started from, becomes a list of
 * changes; each is found again in the student's current text by its words and their neighbours, so the student can
 * keep writing while a suggestion waits, and a change whose spot was rewritten shows as "The draft changed here".
 *
 * Pure; safe in server code, client components, and tests. The Server Actions (lib/essays/store.ts) and the Review
 * changes view (components/essays/ReviewChanges.tsx) both read these.
 */
import { isWord, tokenize, wordDiff, type Token } from "./diff.ts";
import { normalizeText } from "./normalize.ts";

/**
 * One change: the words taken out (empty for a pure insertion), the words put in (empty for a deletion), and up to
 * three words of the base text either side. `before` keeps the whitespace that touches the change (as one space),
 * and so does `after`, so `before + removed + after` reads as the base did.
 */
export interface Change {
  key: string;
  removed: string;
  inserted: string;
  before: string;
  after: string;
}

/** Absolute offsets in the given text; `start === end` for a pure insertion. */
export interface Located {
  start: number;
  end: number;
}

export type Decision = "accepted" | "rejected";

/** An `essay_suggestions` row (supabase/migrations/20261101120000_essay_suggestions.sql). */
export interface SuggestionRow {
  id: string;
  essay_id: string;
  /** The newest version when its text was the one the editor started from; null when the draft had moved on since. */
  base_version_id: string | null;
  /** The text the editor started from; the changes are always computed from it. */
  base_body: string;
  author_id: string | null;
  author_role: "guardian" | "counselor";
  proposed_body: string;
  note: string | null;
  status: "open" | "decided" | "withdrawn";
  decisions: Record<string, Decision>;
  created: string;
  updated: string;
  decided_at: string | null;
}

export interface ChangeView extends Change {
  decision: Decision | null;
  /** Where the change sits in the current text: an open change's removed words, an accepted one's inserted words. */
  located: Located | null;
}

/** Unchanged words closer than this join two edits into one change; also the context kept either side. */
const CONTEXT_WORDS = 3;

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 as hex (synchronous, so the browser and the server compute the same keys without Web Crypto's promise). */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false);
  view.setUint32(padded.length - 4, (len << 3) >>> 0, false);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

/** A change's key: the first 16 hex of SHA-256 over its four strings and its ordinal among identical changes. */
export function changeKey(c: Omit<Change, "key">, ordinal: number): string {
  return sha256Hex(`${c.removed}\u0000${c.inserted}\u0000${c.before}\u0000${c.after}\u0000${ordinal}`).slice(0, 16);
}

/** The ordinal a change's key was made with (0 unless the draft had identical changes). */
function ordinalOf(c: Change): number {
  for (let i = 0; i < 64; i++) if (changeKey(c, i) === c.key) return i;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Computing the changes                                               */
/* ------------------------------------------------------------------ */

const isSpace = (t: Token | undefined) => t !== undefined && !isWord(t);
const collapse = (s: string) => s.replace(/\s+/g, " ");

/** A stretch of edits: base tokens [b0, b1) became proposed tokens [p0, p1). */
interface Hunk {
  b0: number;
  b1: number;
  p0: number;
  p1: number;
}

/**
 * The changes from `base` to `proposed`, in text order. Edits fewer than three unchanged words apart join one change;
 * a change that is only whitespace inside a paragraph (a double space) is dropped; a moved paragraph break is a change.
 */
export function changesBetween(base: string, proposed: string): Change[] {
  const a = tokenize(base);
  const b = tokenize(proposed);
  const ops = wordDiff(a, b);

  // Hunks with their token ranges in both texts.
  let hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.kind === "equal") {
      ai += op.tokens.length;
      bi += op.tokens.length;
      continue;
    }
    const h: Hunk = { b0: ai, b1: ai, p0: bi, p1: bi };
    while (i < ops.length && ops[i].kind !== "equal") {
      if (ops[i].kind === "delete") h.b1 = ai += ops[i].tokens.length;
      else h.p1 = bi += ops[i].tokens.length;
      i++;
    }
    i--;
    hunks.push(h);
  }

  // A change's edge never splits a run of whitespace in the base (" " then "\n"): the unchanged whitespace beside
  // it joins the change, so finding it again by its words can't land inside a run. Only unchanged tokens join (never
  // past a neighbouring change), so the two texts' ranges stay aligned.
  const bounds = hunks.map((h, i) => ({ lo: i > 0 ? hunks[i - 1].b1 : 0, hi: i + 1 < hunks.length ? hunks[i + 1].b0 : a.length }));
  hunks.forEach((h, i) => {
    const { lo, hi } = bounds[i];
    while (h.b0 > lo && isSpace(a[h.b0 - 1]) && (isSpace(a[h.b0]) || (h.p0 < h.p1 && isSpace(b[h.p0])))) {
      h.b0--;
      h.p0--;
    }
    while (h.b1 < hi && isSpace(a[h.b1]) && (isSpace(a[h.b1 - 1]) || (h.p0 < h.p1 && isSpace(b[h.p1 - 1])))) {
      h.b1++;
      h.p1++;
    }
  });

  // Whitespace inside a paragraph only: dropped.
  const blank = (h: Hunk) => {
    const toks = [...a.slice(h.b0, h.b1), ...b.slice(h.p0, h.p1)];
    return toks.every((t) => !isWord(t)) && !toks.includes("\n");
  };
  hunks = hunks.filter((h) => !blank(h));

  // Join edits closer than three unchanged words.
  const merged: Hunk[] = [];
  for (const h of hunks) {
    const last = merged[merged.length - 1];
    if (last && a.slice(last.b1, h.b0).filter(isWord).length < CONTEXT_WORDS) {
      last.b1 = Math.max(last.b1, h.b1);
      last.p1 = Math.max(last.p1, h.p1);
    } else merged.push({ ...h });
  }

  const changes: Change[] = merged.map((h) => {
    let s = h.b0;
    let words = 0;
    while (s > 0 && words < CONTEXT_WORDS) {
      s--;
      if (isWord(a[s])) words++;
    }
    let e = h.b1;
    words = 0;
    while (e < a.length && words < CONTEXT_WORDS) {
      if (isWord(a[e])) words++;
      e++;
    }
    return {
      key: "",
      removed: a.slice(h.b0, h.b1).join(""),
      inserted: b.slice(h.p0, h.p1).join(""),
      before: collapse(a.slice(s, h.b0).join("")),
      after: collapse(a.slice(h.b1, e).join("")),
    };
  });

  const seen = new Map<string, number>();
  for (const c of changes) {
    const id = `${c.removed}\u0000${c.inserted}\u0000${c.before}\u0000${c.after}`;
    const ordinal = seen.get(id) ?? 0;
    seen.set(id, ordinal + 1);
    c.key = changeKey(c, ordinal);
  }
  return changes;
}

/* ------------------------------------------------------------------ */
/* Finding a change in the current text                                */
/* ------------------------------------------------------------------ */

/** The text with each run of whitespace as one space, and for each position of that the offset in the original. */
function collapsed(text: string): { text: string; orig: number[] } {
  let out = "";
  const orig: number[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      orig.push(i);
      out += " ";
      while (i < text.length && /\s/.test(text[i])) i++;
    } else {
      orig.push(i);
      out += text[i];
      i++;
    }
  }
  orig.push(text.length);
  return { text: out, orig };
}

/** Starts of `needle` in `hay` at word edges (never inside a word), without overlaps. */
function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  const edge = (i: number) => i <= 0 || i >= hay.length || hay[i - 1] === " " || hay[i] === " ";
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return out;
    if (edge(at) && edge(at + needle.length)) {
      out.push(at);
      from = at + needle.length;
    } else from = at + 1;
  }
}

/**
 * The words `middle` stands for, between `before` and `after`, in `current`: first the three together (when they
 * occur more than once, the occurrence the change's ordinal names); then `middle` alone when it holds a word and
 * occurs exactly once. Comparisons see every run of whitespace as one space. Null when neither finds it.
 */
function locateMiddle(current: string, before: string, middle: string, after: string, ordinal: number): Located | null {
  const cur = collapsed(current);
  const pattern = collapsed(before + middle + after);
  // Where `middle` starts and ends inside the collapsed pattern.
  const at = (raw: number) => {
    let n = 0;
    while (n < pattern.text.length && pattern.orig[n] < raw) n++;
    return n;
  };
  const pre = at(before.length);
  const lead = Math.max(pre, at(before.length + middle.length));
  const hits = occurrences(cur.text, pattern.text);
  const hit = hits.length === 1 ? hits[0] : hits.length > ordinal ? hits[ordinal] : -1;
  if (hit >= 0) return { start: cur.orig[hit + pre], end: cur.orig[hit + lead] };
  if (/\S/.test(middle)) {
    const alone = collapse(middle);
    const solo = occurrences(cur.text, alone);
    if (solo.length === 1) return { start: cur.orig[solo[0]], end: cur.orig[solo[0] + alone.length] };
  }
  return null;
}

/**
 * Where an open change sits in `current`: its removed words with their neighbours, then the removed words alone when
 * they occur once; a pure insertion is found by its neighbours side by side (the first rule, with nothing between).
 * Null when the student has rewritten the spot (stale: "The draft changed here").
 */
export function locateChange(current: string, change: Change): Located | null {
  if (!change.removed && !change.before && !change.after) return current.length === 0 ? { start: 0, end: 0 } : null;
  return locateMiddle(current, change.before, change.removed, change.after, ordinalOf(change));
}

/** Where an accepted change's inserted words sit now (for its mark only). */
function locateAccepted(current: string, change: Change): Located | null {
  if (!change.inserted.trim()) return null;
  return locateMiddle(current, change.before, change.inserted, change.after, ordinalOf(change));
}

/* ------------------------------------------------------------------ */
/* Views, applying, status                                             */
/* ------------------------------------------------------------------ */

/** Every change of a suggestion with its decision and where it sits in the current text. */
export function viewChanges(current: string, base: string, s: Pick<SuggestionRow, "proposed_body" | "decisions">): ChangeView[] {
  return changesBetween(base, s.proposed_body).map((c) => {
    const decision = s.decisions?.[c.key] ?? null;
    const located = decision === null ? locateChange(current, c) : decision === "accepted" ? locateAccepted(current, c) : null;
    return { ...c, decision, located };
  });
}

/**
 * The changes applied to `current`, from the end of the text to the start; each is found again in the text as it
 * stands just before it is applied, and one that no longer fits (or would overlap one already applied) is stale.
 * Returns the keys applied and the keys stale, each in the order given.
 */
export function applyChanges(current: string, changes: readonly Change[]): { text: string; applied: string[]; stale: string[] } {
  const placed = changes.map((c) => ({ c, at: locateChange(current, c) }));
  const order = placed.filter((p) => p.at).sort((x, y) => y.at!.start - x.at!.start || y.at!.end - x.at!.end);
  const done = new Set<string>();
  let text = current;
  let floor = Infinity;
  for (const { c } of order) {
    const at = locateChange(text, c);
    if (!at || at.end > floor) continue;
    text = text.slice(0, at.start) + c.inserted + text.slice(at.end);
    floor = at.start;
    done.add(c.key);
  }
  return {
    text: normalizeText(text),
    applied: changes.filter((c) => done.has(c.key)).map((c) => c.key),
    stale: changes.filter((c) => !done.has(c.key)).map((c) => c.key),
  };
}

export type Segment = { kind: "text" | "del" | "ins"; text: string; key?: string };

/** Open changes that sit in the text, in text order, none overlapping an earlier one. */
function openPlaced(changes: readonly ChangeView[]): (ChangeView & { located: Located })[] {
  const open = changes.filter((c): c is ChangeView & { located: Located } => c.decision === null && c.located !== null);
  open.sort((x, y) => x.located.start - y.located.start || x.located.end - y.located.end);
  const out: (ChangeView & { located: Located })[] = [];
  let end = -1;
  for (const c of open) {
    if (c.located.start < end) continue;
    out.push(c);
    end = Math.max(end, c.located.end);
  }
  return out;
}

/** "With changes": the current text with each open change's words struck (del) and the new words after them (ins). */
export function renderWithChanges(current: string, changes: readonly ChangeView[]): Segment[] {
  const out: Segment[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  let pos = 0;
  for (const c of openPlaced(changes)) {
    text(current.slice(pos, c.located.start));
    const removed = current.slice(c.located.start, c.located.end);
    if (removed) out.push({ kind: "del", text: removed, key: c.key });
    if (c.inserted) out.push({ kind: "ins", text: c.inserted, key: c.key });
    pos = c.located.end;
  }
  text(current.slice(pos));
  return out;
}

/** "As suggested": the current text with every open change that sits in it accepted. */
export function asSuggested(current: string, changes: readonly ChangeView[]): string {
  return applyChanges(current, openPlaced(changes)).text;
}

/** Decided when every change has a decision. */
export function statusAfter(changes: readonly Change[], decisions: Record<string, Decision>): "open" | "decided" {
  return changes.every((c) => decisions[c.key] === "accepted" || decisions[c.key] === "rejected") ? "decided" : "open";
}

/** The version list's line for a decided suggestion: "Accepted 3 of 4 changes from Jane". */
export function suggestionLabel(name: string, accepted: number, total: number): string {
  return `Accepted ${accepted} of ${total} ${total === 1 ? "change" : "changes"} from ${name}`.slice(0, 80);
}

/**
 * What a decision does (decideSuggestion in lib/essays/store.ts, kept pure here so it is tested without a database):
 * the incoming decisions for changes still undecided are merged over the stored ones; the newly accepted changes are
 * applied to the current text; an accepted change that no longer fits is left undecided and reported stale (the
 * student sees "The draft changed here" and may still reject it). Keys that aren't the suggestion's are ignored.
 */
export function planDecision(
  current: string,
  base: string,
  proposed: string,
  stored: Record<string, Decision>,
  incoming: Record<string, Decision>,
): {
  text: string;
  decisions: Record<string, Decision>;
  applied: string[];
  stale: string[];
  rejected: string[];
  status: "open" | "decided";
  accepted: number;
  total: number;
  /** Every change still open was decided in this one call (Accept all, Reject all). */
  all: boolean;
} {
  const changes = changesBetween(base, proposed);
  const undecided = changes.filter((c) => !stored[c.key]);
  const fresh = undecided.filter((c) => incoming[c.key] === "accepted" || incoming[c.key] === "rejected");
  const toAccept = fresh.filter((c) => incoming[c.key] === "accepted");
  const rejected = fresh.filter((c) => incoming[c.key] === "rejected").map((c) => c.key);
  const result = toAccept.length > 0 ? applyChanges(current, toAccept) : { text: current, applied: [], stale: [] };
  const decisions: Record<string, Decision> = {};
  for (const c of changes) if (stored[c.key]) decisions[c.key] = stored[c.key];
  for (const k of result.applied) decisions[k] = "accepted";
  for (const k of rejected) decisions[k] = "rejected";
  return {
    text: result.text,
    decisions,
    applied: result.applied,
    stale: result.stale,
    rejected,
    status: statusAfter(changes, decisions),
    accepted: Object.values(decisions).filter((d) => d === "accepted").length,
    total: changes.length,
    all: undecided.length > 1 && fresh.length === undecided.length,
  };
}
