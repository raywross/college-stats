/**
 * The word diff behind suggested changes (specs/product/essays/editors.md "The changes"): the text as tokens (words,
 * the whitespace between them, and paragraph breaks), and a Myers shortest edit script over those tokens. Written
 * in-house rather than taking a dependency; a 650-word draft against a full rewrite takes a few milliseconds.
 *
 * Pure; safe in server code, client components, and tests.
 */
import { normalizeText } from "./normalize.ts";

/** A word (a run of non-whitespace), a run of whitespace other than a line break, or "\n" (one line break). */
export type Token = string;

const TOKEN = /\n|[^\S\n]+|\S+/g;

/** The text (normalized as the workspace stores it) as tokens; `tokenize(t).join("") === normalizeText(t)`. */
export function tokenize(text: string): Token[] {
  return normalizeText(text).match(TOKEN) ?? [];
}

/** A word token (not whitespace, not a line break). */
export const isWord = (t: Token): boolean => t.length > 0 && !/^\s+$/.test(t);

export type Op = { kind: "equal" | "delete" | "insert"; tokens: Token[] };

/**
 * The shortest edit script turning `a` into `b`, as runs of equal, deleted and inserted tokens. Deterministic: within
 * one stretch of edits the deletions come before the insertions, and consecutive runs of one kind are joined.
 */
export function wordDiff(a: readonly Token[], b: readonly Token[]): Op[] {
  // Tokens as numbers, so the inner loop compares integers.
  const ids = new Map<string, number>();
  const id = (t: string) => {
    let v = ids.get(t);
    if (v === undefined) ids.set(t, (v = ids.size));
    return v;
  };
  const A = Int32Array.from(a, id);
  const B = Int32Array.from(b, id);

  // The common head and tail never enter the search.
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;

  const edits: { kind: Op["kind"]; token: Token }[] = [];
  for (let i = 0; i < head; i++) edits.push({ kind: "equal", token: a[i] });
  middle(A.subarray(head, A.length - tail), B.subarray(head, B.length - tail), (kind, ai, bi) => {
    edits.push({ kind, token: kind === "insert" ? b[head + bi] : a[head + ai] });
  });
  for (let i = A.length - tail; i < A.length; i++) edits.push({ kind: "equal", token: a[i] });

  // Runs: deletions before insertions inside each stretch of edits, then join neighbours of one kind.
  const ops: Op[] = [];
  const push = (kind: Op["kind"], tokens: Token[]) => {
    if (tokens.length === 0) return;
    const last = ops[ops.length - 1];
    if (last && last.kind === kind) last.tokens.push(...tokens);
    else ops.push({ kind, tokens: [...tokens] });
  };
  let i = 0;
  while (i < edits.length) {
    if (edits[i].kind === "equal") {
      push("equal", [edits[i].token]);
      i++;
      continue;
    }
    const del: Token[] = [];
    const ins: Token[] = [];
    while (i < edits.length && edits[i].kind !== "equal") {
      (edits[i].kind === "delete" ? del : ins).push(edits[i].token);
      i++;
    }
    push("delete", del);
    push("insert", ins);
  }
  return ops;
}

/**
 * Myers' O((N+M)D) greedy search with the trace kept per step (only the diagonals that step reached), then walked back
 * from the end. Calls `emit` in text order with indexes into `a` (equal, delete) or `b` (insert).
 */
function middle(a: Int32Array, b: Int32Array, emit: (kind: Op["kind"], ai: number, bi: number) => void): void {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    // The diagonals -d..d after step d.
    trace.push(v.slice(offset - d, offset + d + 1));
  }

  const back: { kind: Op["kind"]; ai: number; bi: number }[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1];
    const at = (k: number) => prev[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      back.push({ kind: "equal", ai: x, bi: y });
    }
    if (down) {
      y--;
      back.push({ kind: "insert", ai: x, bi: y });
    } else {
      x--;
      back.push({ kind: "delete", ai: x, bi: y });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    back.push({ kind: "equal", ai: x, bi: y });
  }
  for (let i = back.length - 1; i >= 0; i--) emit(back[i].kind, back[i].ai, back[i].bi);
}
