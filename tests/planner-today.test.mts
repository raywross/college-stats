import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isoDay, overrideAllowed, parseTodaySetting, pretendTodayLine, TODAY_SETTING } from "../lib/planner/today.ts";
import { seasonOf } from "../lib/planner/seasons.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("a day is a real YYYY-MM-DD, nothing else", () => {
  assert.equal(isoDay("2027-03-15"), "2027-03-15");
  assert.equal(isoDay("2027-02-30"), null);
  assert.equal(isoDay("2027-3-5"), null);
  assert.equal(isoDay("2027-03-15T00:00:00Z"), null);
  assert.equal(isoDay(20270315), null);
  assert.equal(isoDay(null), null);
});

test("the setting is honored everywhere but production", () => {
  assert.equal(overrideAllowed("development"), true);
  assert.equal(overrideAllowed("preview"), true);
  assert.equal(overrideAllowed(undefined), true);
  assert.equal(overrideAllowed("production"), false);
  assert.equal(parseTodaySetting("2027-03-15", "preview"), "2027-03-15");
  assert.equal(parseTodaySetting("2027-03-15", "production"), null, "production never pretends");
  assert.equal(parseTodaySetting(null, "preview"), null);
  assert.equal(parseTodaySetting(true, "preview"), null);
});

test("the banner names the day in words, without the time zone moving it", () => {
  assert.equal(pretendTodayLine("2027-03-15"), "Quad is pretending today is Monday, March 15, 2027.");
  assert.equal(pretendTodayLine("2026-12-31"), "Quad is pretending today is Thursday, December 31, 2026.");
});

test("one overridden day walks a class of 2027 student through every season of the cycle", () => {
  const walk: [string, string][] = [
    ["2025-09-15", "junior_fall"],
    ["2026-01-15", "junior_winter"],
    ["2026-04-10", "junior_spring"],
    ["2026-07-15", "summer_before_senior"],
    ["2026-10-01", "senior_fall"],
    ["2027-01-20", "senior_winter"],
    ["2027-04-05", "senior_spring"],
    ["2027-07-01", "summer_after"],
  ];
  for (const [day, season] of walk) assert.equal(seasonOf(2027, day), season, day);
});

test("every planner page and Server Action asks today-server for the day, not the clock", () => {
  // Pretend today works only because these sites take their date from plannerToday(); a todayIso() here would make
  // one page or write ignore the setting. The clock stays real on purpose in the cron routes and outside the planner.
  const sites = [
    "lib/planner/load.ts", "lib/planner/hub.ts", "lib/planner/store-plan.ts", "lib/planner/store.ts", "lib/planner/store-actions.ts",
    "lib/planner/store-apply.ts", "lib/planner/store-offers.ts", "lib/essays/store.ts", "app/api/plan/next/route.ts",
    "app/advisor/print/page.tsx", "app/household/[person]/page.tsx", "app/org/page.tsx", "app/org/students/[id]/page.tsx", "app/org/export/route.ts",
  ];
  for (const f of sites) {
    const src = read(f);
    assert.ok(!/\btodayIso\(\)/.test(src), `${f} reads the real clock; use plannerToday()`);
    assert.match(src, /plannerToday\(\)/, `${f} should read plannerToday()`);
  }
  assert.match(read("lib/planner/today-server.ts"), new RegExp(`"${TODAY_SETTING.replace(".", "\\\\.")}"|TODAY_SETTING`));
  // The banner sits above every plan a signed-in person opens, the household's person page, and the caseload.
  for (const f of ["app/advisor/page.tsx", "app/household/[person]/page.tsx", "app/org/page.tsx"]) assert.match(read(f), /<PretendTodayBanner \/>/, f);
  // The migration teaches admin_set_setting the key.
  assert.match(read("supabase/migrations/20261105120000_planner_today.sql"), /'planner\.today'/);
});
