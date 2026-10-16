/**
 * A guardian's redacted story and the student's own agree on "written" (QA 2026-10-16: a 150-character story read
 * "Written" to the parent and "Not yet" to the student, so the record's "n of 13" differed by viewer). The redaction
 * carries `written` and never the text; the sanitizer never stores the flag.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactStoryForGuardian, sanitizeStory, storyWritten, STORY_DONE_CHARS } from "../lib/student-profile.ts";

test("a guardian's redacted story counts as written exactly when the student's does", () => {
  const short = { narrative: "x".repeat(STORY_DONE_CHARS - 1), updatedAt: null };
  const long = { narrative: "x".repeat(STORY_DONE_CHARS), updatedAt: null };
  assert.equal(storyWritten({ story: short }), false);
  assert.equal(storyWritten({ story: redactStoryForGuardian(short) }), false, "the parent agrees: not yet");
  assert.equal(storyWritten({ story: long }), true);
  assert.equal(storyWritten({ story: redactStoryForGuardian(long) }), true, "the parent agrees: written");
  assert.equal(redactStoryForGuardian(long)?.narrative, "", "and never sees the text");
});

test("the written flag is never stored: sanitizeStory drops it", () => {
  const saved = sanitizeStory({ narrative: "a story", updatedAt: null, written: true });
  assert.ok(saved && !("written" in saved));
});
