/**
 * The notes panel while a read streams (components/essays/Notes.tsx; specs/product/essays/reviewer.md "Changed
 * (owner, 2026-10-31): the notes stream in"), read as source: the "appear as the reader finds them" line while busy;
 * streamed notes in the same card with Done and Ignore disabled until `done` swaps in the stored review; the stream
 * read with `getReader()` and a line splitter, the JSON path kept for refusals before the read; the kept and not-kept
 * lines after a read stops early. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(import.meta.dirname, "..", "components/essays/Notes.tsx"), "utf8");

test("while busy, the panel says the notes appear as the reader finds them", () => {
  assert.match(SRC, /const READING_LINE = "Reading… notes appear as the reader finds them";/);
  assert.match(SRC, /\{busy && \(\s*<p[^>]*role="status"[^>]*>\s*\{READING_LINE\}/, "shown under the button only while busy");
  assert.doesNotMatch(SRC, /This can take up to a minute/, "the old wait line is gone");
});

test("streamed notes render in the same card with Done and Ignore disabled until done", () => {
  assert.match(SRC, /<NoteList notes=\{streamed\} canMark=\{canRequest\} pending /, "the streamed list is the same NoteList, pending");
  assert.match(SRC, /pending = false/, "stored notes are not pending");
  const done = /<button type="button" disabled=\{pending\} onClick=\{\(\) => onMark\(n, "done"\)\}/;
  const ignore = /<button type="button" disabled=\{pending\} onClick=\{\(\) => onMark\(n, "ignored"\)\}/;
  assert.match(SRC, done, "Done is disabled while pending");
  assert.match(SRC, ignore, "Ignore is disabled while pending");
  // `done` swaps the stored review in and clears the streamed notes.
  assert.match(SRC, /e\.kind === "done"\) \{[\s\S]*?setStreamed\(\[\]\);[\s\S]*?setLoad\(/);
  assert.match(SRC, /id: `streamed-\$\{arrived\.length\}`, state: "open"/, "a streamed note has a placeholder id, never a stored one");
});

test("guard: an enabled Done on a streamed note would PATCH a placeholder id", () => {
  // The PATCH sends note.id; a streamed note's id is "streamed-N", which the route refuses. So the disabled check above
  // is what keeps a student from clicking it: prove the pending prop reaches both buttons and nothing else marks.
  const marks = SRC.match(/onClick=\{\(\) => onMark\(n, "(done|ignored)"\)\}/g) ?? [];
  assert.equal(marks.length, 2);
  const disabled = SRC.match(/disabled=\{pending\} onClick=\{\(\) => onMark\(n, "(done|ignored)"\)\}/g) ?? [];
  assert.equal(disabled.length, marks.length, "every Done/Ignore button carries disabled={pending}");
});

test("the stream is read with getReader and a line splitter; a non-stream reply (an error status with JSON) behaves as before", () => {
  assert.match(SRC, /r\.body\.getReader\(\)/);
  assert.match(SRC, /import \{ lineSplitter \} from "@\/lib\/essays\/review-response";/);
  assert.match(SRC, /decoder\.decode\(value, \{ stream: true \}\)/, "multi-byte characters split across chunks decode whole");
  assert.match(SRC, /includes\("application\/x-ndjson"\)/);
  assert.match(SRC, /if \(!r\.ok \|\| !isStream \|\| !r\.body\) \{[\s\S]*?await r\.json\(\)[\s\S]*?setMessage\(body\.error/);
});

test("a read that stops early: kept notes say so; notes the server didn't record stay on screen and say they weren't kept", () => {
  assert.match(SRC, /const KEPT_LINE = "The reader stopped early; these notes are kept\.";/);
  assert.match(SRC, /const NOT_KEPT_LINE = "The reader stopped early; these notes weren't kept\.";/);
  assert.match(SRC, /latest\.outcome === "max_tokens" && latest\.notes\.length > 0 && <p[^>]*>\{KEPT_LINE\}/, "kept only when the stored review says the answer was cut");
  assert.match(SRC, /e\.kind === "error"\) \{[\s\S]*?setMessage\(e\.error\);[\s\S]*?setLost\(arrived\.length > 0\)/);
  assert.match(SRC, /\{busy \? "This read so far" : NOT_KEPT_LINE\}/);
});
