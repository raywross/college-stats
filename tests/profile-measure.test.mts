/**
 * The profile and compare measurement script's pure parts (scripts/lib/profile-measure.mts): pages, budgets, the
 * checks on each measurement, the table, and where Playwright is looked for. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPARE_PAGES,
  DEFAULT_IDS,
  PROFILE_PAGES,
  PROFILE_VIEWPORTS,
  comparePagePath,
  compareHeightBudget,
  findPlaywright,
  formatTable,
  heightBudget,
  pagePath,
  problems,
  type Measurement,
} from "../scripts/lib/profile-measure.mts";

const ok: Measurement = {
  id: "166027",
  page: "overview",
  viewport: "phone",
  width: 390,
  status: 200,
  height: 4100,
  innerWidthAtDcl: 390,
  innerWidth: 390,
  scrollWidth: 390,
  brokenLinks: [],
};

test("pages, widths, and default colleges", () => {
  assert.deepEqual([...PROFILE_PAGES], ["overview", "admissions", "students", "academics", "cost", "outcomes", "history"]);
  assert.deepEqual(
    PROFILE_VIEWPORTS.map((v) => v.width),
    [1440, 810, 390]
  );
  assert.equal(DEFAULT_IDS.length, 5);
  assert.equal(pagePath("1", "overview"), "/schools/1");
  assert.equal(pagePath("1", "cost"), "/schools/1/cost");
});

test("height budgets: overview 2,700 desktop / 5,000 phone; topic pages 6,000 desktop; none elsewhere", () => {
  assert.equal(heightBudget("overview", "desktop"), 2700);
  assert.equal(heightBudget("overview", "phone"), 5000);
  assert.equal(heightBudget("overview", "tablet"), null);
  assert.equal(heightBudget("outcomes", "desktop"), 6000);
  assert.equal(heightBudget("outcomes", "tablet"), null);
  assert.equal(heightBudget("history", "phone"), null);
});

test("problems: budget, layout viewport at load and after hydration, sideways scroll, links, status", () => {
  assert.deepEqual(problems(ok), []);
  assert.deepEqual(problems({ ...ok, height: 5100 }), ["100px over budget"]);
  assert.deepEqual(problems({ ...ok, innerWidthAtDcl: 412, innerWidth: 412 }), ["innerWidth 412 at load"]);
  assert.deepEqual(problems({ ...ok, innerWidth: 400 }), ["innerWidth 400 after hydration"]);
  assert.deepEqual(problems({ ...ok, scrollWidth: 420 }), ["scrolls sideways (420)"]);
  assert.deepEqual(problems({ ...ok, brokenLinks: ["/schools/1/cost"] }), ["broken links: /schools/1/cost"]);
  assert.deepEqual(problems({ ...ok, status: 500 }), ["HTTP 500"]);
  assert.deepEqual(problems({ ...ok, status: 0 }), ["HTTP error"]);
  // A college without a topic: its page 404s, which isn't a failure (its pills mustn't link there; brokenLinks).
  assert.deepEqual(problems({ ...ok, page: "admissions", status: 404, height: 0, innerWidthAtDcl: 0 }), []);
});

test("table: one row per measurement, aligned, with the verdict last", () => {
  const out = formatTable([ok, { ...ok, viewport: "desktop", width: 1440, height: 3000, innerWidthAtDcl: 1440, innerWidth: 1440, scrollWidth: 1440 }, { ...ok, page: "cost", status: 404 }]);
  const lines = out.split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^page\s+width\s+height\s+budget\s+iw@DCL\s+iw\s+scrollW\s+result$/);
  assert.match(lines[2], /^166027 overview\s+390\s+4,100\s+5,000\s+390\s+390\s+390\s+ok, within budget$/);
  assert.match(lines[3], /FAIL: 300px over budget$/);
  assert.match(lines[4], /^166027 cost\s+390\s+-\s+-\s+-\s+-\s+-\s+404 \(no topic\)$/);
});

test("Playwright is found in PLAYWRIGHT_DIR (an install folder or the package itself), else not at all", () => {
  const dir = mkdtempSync(join(tmpdir(), "pw-"));
  const pkg = join(dir, "node_modules", "playwright");
  const emptyRepo = mkdtempSync(join(tmpdir(), "repo-"));
  assert.equal(findPlaywright(dir, emptyRepo), null);
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "playwright" }));
  assert.equal(findPlaywright(dir, emptyRepo), pkg);
  assert.equal(findPlaywright(pkg, emptyRepo), pkg);
  assert.equal(findPlaywright(undefined, emptyRepo), null);
  // Some other package at that path doesn't count.
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "not-playwright" }));
  assert.equal(findPlaywright(dir, emptyRepo), null);
});

// --- Compare mode (specs/compare-redesign.md#budget) -----------------------------------------------------------

const compareOk: Measurement = {
  id: "166027,204796,110662",
  ids: ["166027", "204796", "110662"],
  page: "cost",
  viewport: "desktop",
  width: 1440,
  status: 200,
  height: 3000,
  innerWidthAtDcl: 1440,
  innerWidth: 1440,
  scrollWidth: 1440,
  brokenLinks: [],
};

test("compare pages: the overview, six topics, and the table, in pill order", () => {
  assert.deepEqual([...COMPARE_PAGES], ["overview", "admissions", "students", "academics", "cost", "outcomes", "history", "table"]);
});

test("compare page paths: /compare?ids= for the overview, /compare/{page}?ids= for every other page", () => {
  assert.equal(comparePagePath(["166027", "204796", "110662"], "overview"), "/compare?ids=166027,204796,110662");
  assert.equal(comparePagePath(["166027", "204796"], "cost"), "/compare/cost?ids=166027,204796");
  assert.equal(comparePagePath(["166027", "204796"], "table"), "/compare/table?ids=166027,204796");
});

test("compare height budgets: overview 2,500 desktop / 4,000 phone / none tablet; topic pages 4,000 desktop, none elsewhere; the table none", () => {
  assert.equal(compareHeightBudget("overview", "desktop"), 2500);
  assert.equal(compareHeightBudget("overview", "phone"), 4000);
  assert.equal(compareHeightBudget("overview", "tablet"), null);
  for (const page of ["admissions", "students", "academics", "cost", "outcomes", "history"] as const) {
    assert.equal(compareHeightBudget(page, "desktop"), 4000);
    assert.equal(compareHeightBudget(page, "tablet"), null);
    assert.equal(compareHeightBudget(page, "phone"), null);
  }
  // The table is the complete view: every row for every college, so no height budget applies.
  for (const viewport of ["desktop", "tablet", "phone"] as const) assert.equal(compareHeightBudget("table", viewport), null);
});

test("profile height budgets are unchanged by the compare addition", () => {
  assert.equal(heightBudget("overview", "desktop"), 2700);
  assert.equal(heightBudget("overview", "phone"), 5000);
  assert.equal(heightBudget("outcomes", "desktop"), 6000);
  assert.equal(heightBudget("history", "tablet"), null);
});

test("problems checks a compare measurement against the compare budget, not the profile one, via its ids", () => {
  assert.deepEqual(problems(compareOk), []);
  // 4,500 is under a profile topic page's 6,000 budget but over a compare page's 4,000: this proves the `ids`
  // field, not the page name (both profile and compare have a "cost" page), selects compareHeightBudget.
  assert.deepEqual(problems({ ...compareOk, height: 4500 }), ["500px over budget"]);
  assert.deepEqual(problems({ ...compareOk, page: "overview", height: 2800 }), ["300px over budget"]);
  assert.deepEqual(
    problems({ ...compareOk, page: "overview", viewport: "phone", width: 390, innerWidthAtDcl: 390, innerWidth: 390, scrollWidth: 390, height: 4100 }),
    ["100px over budget"]
  );
});

test("table: a compare row's first column reads 'compare a+b+c page'", () => {
  const out = formatTable([compareOk]);
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[2], /^compare 166027\+204796\+110662 cost\s+1440\s+3,000\s+4,000\s+1440\s+1440\s+1440\s+ok, within budget$/);
});

test("table: profile and compare rows side by side keep their own labels and budgets", () => {
  const out = formatTable([ok, compareOk]);
  const lines = out.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[2], /^166027 overview\s+390\s+4,100\s+5,000\s+390\s+390\s+390\s+ok, within budget$/);
  assert.match(lines[3], /^compare 166027\+204796\+110662 cost\s+1440\s+3,000\s+4,000\s+1440\s+1440\s+1440\s+ok, within budget$/);
});
