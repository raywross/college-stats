/**
 * The identity-refresh workflow's due check, PR body, and release note (scripts/identity-refresh.mts), against a
 * few real schools cloned and given synthetic links/social/brand so a full School object doesn't need to be
 * hand-built. `npm test`. See .github/workflows/identity-refresh.yml and specs/school-identity/follow-ups.md,
 * "The monthly refresh".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LinkIssue } from "../lib/identity-files";
import type { School } from "../lib/types";
import { parseReleaseNote, releaseNoteProblem } from "../lib/release-notes.ts";
import { MIN_REFRESH_DAYS, diffIdentity, newestRetrieved, prBody, refreshDue, releaseNote, releaseNoteSlug } from "../scripts/identity-refresh.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const pick = (id: string): School => structuredClone(byId.get(id)!);

// Real unit ids (also used by tests/identity.test.mts), so these are ordinary, fully-shaped School objects.
const UGA = "139959";
const VANDERBILT = "221999";
const THIRD = "166027";

const BRAND_BASE = { colors: null, names: null, accent: null, on_accent: null, tint_light: null, tint_dark: null } as const;

/* ------------------------------------------------------------------ */
/* due                                                                 */
/* ------------------------------------------------------------------ */

test("refreshDue is the spec's 28-day rule: not due at 27 days, due at 28", () => {
  assert.equal(MIN_REFRESH_DAYS, 28);
  assert.equal(refreshDue([{ retrieved: "2026-09-07" }], "2026-10-04"), false); // 27 days old
  assert.equal(refreshDue([{ retrieved: "2026-09-06" }], "2026-10-04"), true); // 28 days old
});

test("refreshDue is true with no file (an empty probe has never run)", () => {
  assert.equal(refreshDue([], "2026-10-04"), true);
  assert.equal(newestRetrieved([]), null);
});

test("refreshDue goes by the newest retrieved date among several entries, not the oldest", () => {
  const entries = [{ retrieved: "2026-08-01" }, { retrieved: "2026-09-10" }, { retrieved: "2026-09-01" }];
  assert.equal(newestRetrieved(entries), "2026-09-10");
  assert.equal(refreshDue(entries, "2026-10-04"), false); // newest is 24 days old
  assert.equal(refreshDue(entries, "2026-10-08"), true); // newest is 28 days old
});

/* ------------------------------------------------------------------ */
/* diffIdentity                                                        */
/* ------------------------------------------------------------------ */

test("diffIdentity counts visit/social/colors/marks before and after, and names who gained or lost each", () => {
  const before = [pick(UGA), pick(VANDERBILT), pick(THIRD)];
  const after = [pick(UGA), pick(VANDERBILT), pick(THIRD)];

  // Pin every fixture school to a known baseline (no visit, no social, no colors, no mark) first, so the counts
  // below don't depend on what these three real colleges happen to already have in the committed dataset.
  const bareLinks = { website: "https://example.edu/", price_calculator: null };
  for (const s of [...before, ...after]) {
    s.links = { ...bareLinks };
    s.social = {};
    s.brand = { ...BRAND_BASE, logo: null };
  }

  // UGA gains a visit page and its colors.
  after[0].links = { ...bareLinks, visit: "https://visit.uga.edu/" };
  after[0].brand = { ...BRAND_BASE, colors: ["#BA0C2F"], logo: null };

  // Vanderbilt loses its social accounts.
  before[1].social = { x: "vanderbiltu" };

  // The third college gains a mark.
  after[2].brand = { ...BRAND_BASE, logo: { source_url: "https://example.edu/favicon.ico", retrieved: "2026-11-01", width: 192 } };

  const diff = diffIdentity(before, after, [], "2026-11-01");

  assert.deepEqual(diff.visit, { before: 0, after: 1, gained: [{ unit_id: UGA, name: before[0].name }], lost: [] });
  assert.deepEqual(diff.colors, { before: 0, after: 1, gained: [{ unit_id: UGA, name: before[0].name }], lost: [] });
  assert.deepEqual(diff.social, { before: 1, after: 0, gained: [], lost: [{ unit_id: VANDERBILT, name: before[1].name }] });
  assert.deepEqual(diff.marks, { before: 0, after: 1, gained: [{ unit_id: THIRD, name: before[2].name }], lost: [] });
  assert.equal(diff.marksAdded.length, 1);
  assert.equal(diff.marksAdded[0].unit_id, THIRD);
  assert.equal(diff.marksAdded[0].source_url, "https://example.edu/favicon.ico");
  assert.equal(diff.marksRemoved.length, 0);
});

test("a school absent from a category both before and after is neither a gain nor a loss", () => {
  const before = [pick(UGA)];
  const after = [pick(UGA)];
  before[0].social = undefined;
  after[0].social = undefined;
  const diff = diffIdentity(before, after, [], "2026-11-01");
  assert.deepEqual(diff.social.gained, []);
  assert.deepEqual(diff.social.lost, []);
});

test("a link that goes from a real value to null is reported as 'became null'; staying null, or starting null, is not", () => {
  const before = [pick(UGA)];
  const after = [pick(UGA)];
  before[0].links = { website: "https://uga.edu/", price_calculator: null, admissions: "https://admissions.uga.edu/", apply: null };
  after[0].links = { website: "https://uga.edu/", price_calculator: null, admissions: null, apply: null };
  const diff = diffIdentity(before, after, [], "2026-11-01");
  assert.equal(diff.becameNull.length, 1);
  assert.deepEqual(diff.becameNull[0], { unit_id: UGA, name: before[0].name, field: "admissions", was: "https://admissions.uga.edu/" });
});

test("failedThisRun keeps only link-issues last failed today; an older, still-open failure is left out", () => {
  const school = pick(UGA);
  const issues: LinkIssue[] = [
    { unit_id: UGA, field: "veterans", url: "https://uga.edu/veterans", failures: 1, last_status: 404, first_failed: "2026-11-01", last_failed: "2026-11-01" },
    { unit_id: UGA, field: "apply", url: "https://uga.edu/apply", failures: 2, last_status: 500, first_failed: "2026-09-01", last_failed: "2026-09-15" },
  ];
  const diff = diffIdentity([school], [school], issues, "2026-11-01");
  assert.equal(diff.failedThisRun.length, 1);
  assert.equal(diff.failedThisRun[0].field, "veterans");
  assert.equal(diff.failedThisRun[0].name, school.name);
});

/* ------------------------------------------------------------------ */
/* prBody                                                              */
/* ------------------------------------------------------------------ */

test("prBody shows the summary table, names a gain, and says plainly when there is nothing to report", () => {
  const before = [pick(UGA)];
  const after = [pick(UGA)];
  before[0].links = { website: "https://uga.edu/", price_calculator: null };
  after[0].links = { website: "https://uga.edu/", price_calculator: null, visit: "https://visit.uga.edu/" };
  const diff = diffIdentity(before, after, [], "2026-11-01");
  const body = prBody(diff);
  assert.match(body, /\| Visit page \| 0 \| 1 \| 1 \| 0 \|/);
  assert.match(body, new RegExp(`Gained: .*\\(${UGA}\\)`));
  assert.match(body, /No stored link failed a liveness check this run\./);
  assert.match(body, /No stored link went from a working value to null this run\./);
  assert.match(body, /No college's mark was added or removed this run\./);
});

test("prBody lists a failed link and a mark added, with the college's name", () => {
  const school = pick(UGA);
  const before = [school];
  const after = [structuredClone(school)];
  // Pinned explicitly (not just left at UGA's real baseline) so this passes regardless of whether the real
  // dataset already has a mark for UGA.
  before[0].brand = { ...BRAND_BASE, logo: null };
  after[0].brand = { ...BRAND_BASE, logo: { source_url: "https://uga.edu/favicon.ico", retrieved: "2026-11-01", width: 192 } };
  const issues: LinkIssue[] = [{ unit_id: UGA, field: "veterans", url: "https://uga.edu/veterans", failures: 1, last_status: 404, first_failed: "2026-11-01", last_failed: "2026-11-01" }];
  const body = prBody(diffIdentity(before, after, issues, "2026-11-01"));
  assert.match(body, /## Links that failed this run/);
  assert.match(body, new RegExp(`${school.name}.*\\(${UGA}\\).*veterans.*404`));
  assert.match(body, /## Marks added and removed/);
  assert.match(body, /1 mark added/);
  assert.match(body, /https:\/\/uga\.edu\/favicon\.ico/);
});

/* ------------------------------------------------------------------ */
/* releaseNote                                                        */
/* ------------------------------------------------------------------ */

test("releaseNoteSlug matches the branch name without its data/ prefix", () => {
  assert.equal(releaseNoteSlug("2026-11-01"), "identity-refresh-20261101");
});

test("releaseNote parses as a valid note: kind data, no # heading, a non-empty summary", () => {
  const before = [pick(UGA)];
  const after = [pick(UGA)];
  before[0].links = { website: "https://uga.edu/", price_calculator: null };
  after[0].links = { website: "https://uga.edu/", price_calculator: null, visit: "https://visit.uga.edu/" };
  const diff = diffIdentity(before, after, [], "2026-11-01");
  const text = releaseNote(diff, 80, "2026-11-01");
  const slug = releaseNoteSlug("2026-11-01");
  const note = parseReleaseNote(`release-notes/${slug}.md`, text);
  assert.equal(note.pr, 80);
  assert.equal(note.date, "2026-11-01");
  assert.equal(note.kind, "data");
  assert.ok(note.summary.length > 0);
  assert.doesNotMatch(text, /^#\s/m);
  assert.match(text, /visit page/i);
});

test("releaseNote says plainly when a run finds nothing new", () => {
  const school = pick(UGA);
  const diff = diffIdentity([school], [structuredClone(school)], [], "2026-11-01");
  const text = releaseNote(diff, 80, "2026-11-01");
  assert.match(text, /nothing new to show this time/);
});

test("releaseNoteProblem passes the note for its own PR number, and fails it for any other (the CI guard this protects)", () => {
  const school = pick(UGA);
  const diff = diffIdentity([school], [structuredClone(school)], [], "2026-11-01");
  const text = releaseNote(diff, 80, "2026-11-01");
  const file = `release-notes/${releaseNoteSlug("2026-11-01")}.md`;
  assert.equal(releaseNoteProblem(80, [{ file, text }]), null);
  const problem = releaseNoteProblem(81, [{ file, text }]);
  assert.ok(problem);
  assert.match(problem!, /no release note/);
});
