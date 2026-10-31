/**
 * The reader's answer as it streams (specs/product/essays/reviewer.md "Changed (owner, 2026-10-31): the notes stream
 * in"): the structured output is one JSON object, `{"notes":[{…},{…}]}`, arriving as text deltas split anywhere (mid
 * word, mid escape, mid number). `noteStream()` is fed those deltas in order and returns each object of the top-level
 * `notes` array the moment its closing brace arrives, parsed, so ./review.ts can guard it and show it before the rest
 * of the answer exists. It tracks brace and bracket depth with string and escape awareness, so a brace or a quote
 * inside a string never counts; a trailing partial object (an answer cut at `max_tokens`) is never returned.
 *
 * Pure; never throws. An object whose text isn't valid JSON (it shouldn't happen under the schema) is skipped and
 * counted in `skipped`.
 */

export interface NoteStream {
  /** Feeds the next text delta; returns the notes whose objects completed within it, in order. */
  push(delta: string): unknown[];
  /** How many complete note objects were returned so far. */
  readonly count: number;
  /** How many complete objects failed to parse. */
  readonly skipped: number;
}

export function noteStream(): NoteStream {
  let depth = 0;
  let inString = false;
  let escaped = false;
  // The last string read at depth 1 (the top-level object's keys), and the key a ':' at depth 1 just bound.
  let topString: string[] | null = null;
  let lastTopString = "";
  let key = "";
  let inNotes = false;
  let capture: string[] | null = null;
  let count = 0;
  let skipped = 0;

  return {
    get count() {
      return count;
    },
    get skipped() {
      return skipped;
    },
    push(delta: string): unknown[] {
      const out: unknown[] = [];
      for (const ch of delta) {
        if (capture) capture.push(ch);
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') {
            inString = false;
            if (topString) {
              lastTopString = topString.join("");
              topString = null;
            }
            continue;
          }
          if (topString) topString.push(ch);
          continue;
        }
        switch (ch) {
          case '"':
            inString = true;
            if (depth === 1) topString = [];
            break;
          case ":":
            if (depth === 1) key = lastTopString;
            break;
          case ",":
            if (depth === 1) key = "";
            break;
          case "{":
            depth++;
            if (inNotes && depth === 3) capture = ["{"];
            break;
          case "[":
            depth++;
            if (depth === 2 && key === "notes") inNotes = true;
            break;
          case "}":
            if (inNotes && depth === 3 && capture) {
              const text = capture.join("");
              capture = null;
              try {
                out.push(JSON.parse(text));
                count++;
              } catch {
                skipped++;
              }
            }
            depth--;
            break;
          case "]":
            if (inNotes && depth === 2) inNotes = false;
            depth--;
            break;
        }
      }
      return out;
    },
  };
}
