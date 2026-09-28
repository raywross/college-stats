/**
 * Release calendar (data/release-calendar.json + lib/releases.ts). `npm test`.
 * See specs/data-page.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyProbes,
  expectedLabel,
  filesToProbe,
  isOverdue,
  isStale,
  nextReleaseFor,
  periodStart,
  type FileProbe,
  type Release,
  type ReleaseCalendar,
} from "../lib/releases.ts";
import { VINTAGE_KEYS } from "../lib/lineage.ts";

const CALENDAR: ReleaseCalendar = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "release-calendar.json"), "utf8"));

const release = (over: Partial<Release> = {}): Release => ({
  id: "r",
  source: "ipeds",
  label: "Release",
  brings: [],
  updates: ["ipeds-adm"],
  expected: "2026-12",
  status: "estimated",
  basis: "",
  url: "https://example.org",
  files: ["ADM2025", "SFA2425"],
  ...over,
});
const cal = (releases: Release[], reviewed = "2026-09-28"): ReleaseCalendar => ({ reviewed, releases, notUsedYet: [], watching: [] });
const probes = (entries: Record<string, FileProbe>) => new Map(Object.entries(entries));
const on = (lastModified: string | null = "2026-12-09"): FileProbe => ({ exists: true, lastModified });
const off: FileProbe = { exists: false, lastModified: null };

test("the calendar file is well-formed", () => {
  assert.match(CALENDAR.reviewed, /^\d{4}-\d{2}-\d{2}$/);
  const ids = new Set<string>();
  for (const r of CALENDAR.releases) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.ok(["estimated", "confirmed", "published"].includes(r.status), `${r.id}: bad status ${r.status}`);
    if (r.expected !== null) assert.match(r.expected, /^\d{4}-\d{2}$/, `${r.id}: expected must be YYYY-MM or null`);
    if (r.expectedEnd) assert.match(r.expectedEnd, /^\d{4}-\d{2}$/, `${r.id}: expectedEnd must be YYYY-MM`);
    if (r.status === "published") assert.match(r.published ?? "", /^\d{4}-\d{2}-\d{2}$/, `${r.id}: published needs a date`);
    for (const v of r.updates) assert.ok(VINTAGE_KEYS.includes(v), `${r.id}: unknown vintage "${v}"`);
    if (r.filesUpdatedAfter) assert.ok(r.files?.length, `${r.id}: filesUpdatedAfter without files`);
    if (r.url !== undefined) assert.match(r.url, /^https:\/\//);
    if (r.expected === null) assert.ok(r.url, `${r.id}: an irregular release needs a link to its changelog`);
    assert.ok(r.brings.length && r.basis, `${r.id}: say what it brings and why that date`);
  }
  for (const w of CALENDAR.watching) assert.ok(w.links.length, `${w.id}: link the evidence`);
});

test("every federal release on the site has a next release or an irregular one", () => {
  for (const v of VINTAGE_KEYS) assert.ok(nextReleaseFor(v, CALENDAR), `nothing in the calendar updates ${v}`);
});

test("periodStart reads display years", () => {
  assert.equal(periodStart("Fall 2024")?.toISOString().slice(0, 10), "2024-09-01");
  assert.equal(periodStart("2023–24")?.toISOString().slice(0, 10), "2023-07-01");
  assert.equal(periodStart("2024-25")?.toISOString().slice(0, 10), "2024-07-01");
  assert.equal(periodStart(null), null);
  assert.equal(periodStart("most recent release"), null);
});

test("expectedLabel formats single months, windows and irregular releases", () => {
  assert.equal(expectedLabel({ expected: "2026-12" }), "Dec 2026");
  assert.equal(expectedLabel({ expected: "2026-08", expectedEnd: "2026-11" }), "Aug–Nov 2026");
  assert.equal(expectedLabel({ expected: "2026-11", expectedEnd: "2027-02" }), "Nov 2026–Feb 2027");
  assert.equal(expectedLabel({ expected: null }), "Irregular");
});

test("a release is overdue only after its last expected month ends", () => {
  const r = release({ expected: "2026-12" });
  assert.equal(isOverdue(r, new Date("2026-12-31T23:00:00Z")), false);
  assert.equal(isOverdue(r, new Date("2027-01-01T00:00:00Z")), true);
  assert.equal(isOverdue({ ...r, status: "published" }, new Date("2027-03-01")), false);
  assert.equal(isOverdue(release({ expected: "2026-08", expectedEnd: "2026-11" }), new Date("2026-11-15")), false);
  assert.equal(isOverdue(release({ expected: null }), new Date("2030-01-01")), false);
});

test("the review warning starts after 90 days", () => {
  assert.equal(isStale({ reviewed: "2026-09-28" }, new Date("2026-12-27")), false);
  assert.equal(isStale({ reviewed: "2026-09-28" }, new Date("2026-12-28")), true);
});

test("nextReleaseFor picks the soonest unpublished release, irregular last", () => {
  const c = cal([
    release({ id: "later", expected: "2027-01" }),
    release({ id: "irregular", expected: null }),
    release({ id: "sooner", expected: "2026-12" }),
    release({ id: "out", expected: "2026-10", status: "published", published: "2026-10-02" }),
  ]);
  assert.equal(nextReleaseFor("ipeds-adm", c)?.id, "sooner");
  assert.equal(nextReleaseFor("ipeds-sfa", c), null);
});

test("a release is marked published only when every file is on NCES", () => {
  const c = cal([release()]);
  assert.deepEqual(applyProbes(c, probes({ ADM2025: on(), SFA2425: off }), "2026-12-10").published, []);
  const { calendar, published } = applyProbes(c, probes({ ADM2025: on(), SFA2425: on() }), "2026-12-10");
  assert.deepEqual(published, ["r"]);
  assert.equal(calendar.releases[0].status, "published");
  assert.equal(calendar.releases[0].published, "2026-12-10");
});

test("revisions count only when the files change after the given date", () => {
  const c = cal([release({ files: ["ADM2024"], filesUpdatedAfter: "2026-09-28" })]);
  assert.deepEqual(applyProbes(c, probes({ ADM2024: on("2025-12-11") }), "2026-10-01").published, []);
  assert.deepEqual(applyProbes(c, probes({ ADM2024: on(null) }), "2026-10-01").published, []);
  assert.deepEqual(applyProbes(c, probes({ ADM2024: on("2026-12-09") }), "2026-12-10").published, ["r"]);
});

test("releases without files are never auto-published, and published ones aren't re-probed", () => {
  const c = cal([release({ id: "manual", files: undefined }), release({ id: "done", status: "published", published: "2026-01-06", files: ["EF2025A"] })]);
  assert.deepEqual(applyProbes(c, probes({}), "2026-12-10").published, []);
  assert.deepEqual(filesToProbe(c), []);
  assert.deepEqual(filesToProbe(cal([release(), release({ id: "b", files: ["ADM2025"] })])), ["ADM2025", "SFA2425"]);
});
