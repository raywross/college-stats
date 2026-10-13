/**
 * Online share (specs/data-expansion/online-share.md): the EF{Y}A_DIST reader and its add-up check, the online-first
 * rule over the history series (with the pandemic falls), the campus-based rule the trends share, Explore's filter, the
 * profile line, and the stored values, recomputed from the cached NCES file when it's there. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { EFA_DIST_COLUMNS, EFA_DIST_FIRST_YEAR, checkOnlineRows, isMostlyOnline, matchesOnline, onlineLine, onlineSharesFrom } from "../lib/online-share.ts";
import { ONLINE_FIRST_SHARE, PANDEMIC_DISTANCE_FALLS, onlineFirstAt, onlineFirstEvalYear, type SchoolHistory } from "../lib/history.ts";
import { campusExclusionOf, isCampusBased, type MoverMember } from "../lib/movers.ts";
import { FILTER_KEYS, countActiveFilters, parseFilters } from "../lib/params.ts";
import { FIELDS } from "../lib/fields.ts";
import { TOPIC_FIELDS } from "../lib/profile-topics.ts";
import { parseCsv } from "../scripts/lib/ipeds.mts";
import { checkOnlineShare } from "../scripts/lib/online-share-sync.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

/** A pivoted EF{Y}A_DIST row: each level's [every course online, some, none, total]. */
const dist = (levels: Record<number, [number | string, number | string, number | string, number | string]>) =>
  Object.fromEntries(
    Object.entries(levels).flatMap(([k, [exc, som, non, tot]]) => [
      [`EFDEEXC_${k}`, String(exc)],
      [`EFDESOM_${k}`, String(som)],
      [`EFDENON_${k}`, String(non)],
      [`EFDETOT_${k}`, String(tot)],
    ])
  );

/* ---- Reader and checks ---- */

test("the reader takes both shares from level 2 (all undergraduates) and level 3 only for the enrollment check", () => {
  // Athens State, fall 2024: 1,702 of 2,535 undergraduates entirely online (the retired reviewed list's reason).
  const s = onlineSharesFrom(dist({ 2: [1702, 433, 400, 2535], 3: [1650, 420, 380, 2450], 12: [90, 0, 10, 100] }))!;
  assert.deepEqual(s, { online_share: 0.6714, online_any_share: 0.8422, undergrads: 2535, degree_seeking: 2450 });
  assert.equal(onlineSharesFrom(dist({ 2: [10, 20, 70, 100] }))!.degree_seeking, null, "no level-3 row: no check, shares still read");
});

test("no row, no undergraduates, a blank total, or a row that doesn't add up gives no share (never 0)", () => {
  assert.equal(onlineSharesFrom(undefined), null);
  assert.equal(onlineSharesFrom(dist({ 12: [5, 5, 90, 100] })), null, "graduate-only college");
  assert.equal(onlineSharesFrom(dist({ 2: [0, 0, 0, 0] })), null, "zero undergraduates: no denominator");
  assert.equal(onlineSharesFrom(dist({ 2: [5, 20, 75, ""] })), null, "a blank total: no denominator");
  assert.deepEqual(onlineSharesFrom(dist({ 2: ["", "", 100, 100] }))?.online_any_share, 0, "a blank part is NCES's not-applicable (flag A): 0");
  assert.equal(onlineSharesFrom(dist({ 2: [-1, 20, 70, 100] })), null, "IPEDS missing-value code");
  assert.equal(onlineSharesFrom(dist({ 2: [60, 20, 70, 100] })), null, "60 + 20 + 70 ≠ 100");
});

test("the add-up check reads every level row and names the ones that fail", () => {
  const rows = new Map([
    ["1", dist({ 1: [10, 20, 70, 100], 2: [5, 15, 60, 80], 12: [5, 5, 10, 20] })],
    ["2", dist({ 2: [30, 30, 40, 100], 3: [30, 30, 30, 100] })],
    ["3", dist({ 2: [1, 1, 1, 3] })],
  ]);
  const r = checkOnlineRows(rows, ["1", "2", "3", "4"]);
  assert.equal(r.checked, 6, "every level row of the colleges asked for");
  assert.equal(r.colleges, 3, "a college missing from the file isn't counted");
  assert.deepEqual(r.problems, ["2 level 3: 30 + 30 + 30 ≠ 100"]);
  assert.deepEqual(checkOnlineRows(new Map([["5", dist({ 2: [1, 1, 0, ""] })]]), ["5"]).problems, ["5 level 2: a count is blank or unreadable"]);
});

test("sync-data stops when over 1% of rows don't add up, and flags (never fails) enrollment more than 10% off", () => {
  const ids = Array.from({ length: 100 }, (_, i) => String(i));
  const fake = (bad: number) => ({
    name: "EF2024A_DIST",
    url: "",
    csv: "",
    revised: false,
    columns: new Set(["UNITID", ...EFA_DIST_COLUMNS]),
    rows: new Map(ids.map((id, i) => [id, dist({ 2: [10, 20, i < bad ? 69 : 70, 100], 3: [10, 20, 60, 90] })])),
  });
  const college = (id: string, size: number) => ({ unit_id: id, name: `College ${id}`, demographics: { undergrad_enrollment: size } }) as School;
  const list = ids.map((id) => college(id, id === "7" ? 50 : 90));
  const ok = checkOnlineShare(fake(1), 2024, list);
  assert.equal(ok.checked, 200);
  assert.equal(ok.problems.length, 1, "one bad row in 200 is a college's typo: reported, not fatal");
  assert.deepEqual(ok.flagged, ["College 7 (7): EF2024A_DIST level 3 90, undergrad_enrollment 50"]);
  assert.equal(ok.compared, 99, "the college whose row doesn't add up has no share to compare");
  assert.throws(() => checkOnlineShare(fake(3), 2024, list), /don't add up .* for 3 of 200/);
});

/* ---- The online-first rule ---- */

const hist = (start: number, values: (number | null)[]): SchoolHistory => ({ unit_id: "1", series: { online_share: { start, values } } });

test("online-first: more than half entirely online that fall; exactly half is campus-based; no share is null", () => {
  assert.equal(ONLINE_FIRST_SHARE, 0.5);
  const h = hist(2014, [0.62, 0.5, null, 0.49]);
  assert.equal(onlineFirstAt(h, 2014), true);
  assert.equal(onlineFirstAt(h, 2015), false, "50% is not more than half");
  assert.equal(onlineFirstAt(h, 2016), null, "not reported that fall: no other fall stands in");
  assert.equal(onlineFirstAt(h, 2017), false);
  assert.equal(onlineFirstAt(h, 2013), null, "before the series starts");
});

test("online-first: the pandemic falls are read at the fall before them, never as reported", () => {
  assert.deepEqual([...PANDEMIC_DISTANCE_FALLS], [2020, 2021]);
  assert.equal(onlineFirstEvalYear(2020), 2019);
  assert.equal(onlineFirstEvalYear(2021), 2019);
  assert.equal(onlineFirstEvalYear(2022), 2022);
  // A campus that taught online in fall 2020 and 2021 stays a campus; one online-first in fall 2019 stays online-first.
  const campus = hist(2019, [0.03, 0.91, 0.64, 0.08]);
  assert.equal(onlineFirstAt(campus, 2020), false);
  assert.equal(onlineFirstAt(campus, 2021), false);
  assert.equal(onlineFirstAt(campus, 2022), false);
  assert.equal(onlineFirstAt(hist(2019, [0.8, 0.85]), 2020), true);
  assert.equal(onlineFirstAt(hist(2020, [0.9, 0.9]), 2021), null, "no fall 2019 share: null, as callers then count it campus-based");
});

test("campus-based: not for-profit, not online-first at either end of the window, not a campus reorganized inside the window", () => {
  const school = (id: string, type: School["type"]) => ({ unit_id: id, type }) as School;
  const m = (id: string, type: School["type"], h: SchoolHistory): MoverMember => ({ school: school(id, type), h: { ...h, unit_id: id } });
  const campuses = new Map([["9", { before: 2018 }]]);
  const campus = m("1", "public", hist(2014, [0.1, 0.1, 0.2, 0.3, 0.4, 0.55, 0.6, 0.7, 0.7, 0.7, 0.7]));
  assert.equal(isCampusBased(campus, 2014, 2024, campuses), false, "went online-first inside the window: online-first at the end, so out");
  assert.equal(isCampusBased(campus, 2014, 2017, campuses), true, "campus-based at both ends of an earlier window");
  assert.equal(campusExclusionOf(campus, 2019, 2024, campuses), "online-first", "online-first at a later window's start");
  assert.equal(campusExclusionOf(campus, 2021, 2021, campuses), "online-first", "a pandemic fall reads fall 2019 (0.55)");
  assert.equal(campusExclusionOf(m("2", "private-forprofit", hist(2014, [0.1])), 2014, 2024, campuses), "for-profit");
  assert.equal(campusExclusionOf(m("9", "public", hist(2014, [0.1])), 2014, 2024, campuses), "closed-or-merged");
  assert.equal(isCampusBased(m("9", "public", hist(2014, [0.1])), 2019, 2024, campuses), true, "a window entirely after the merger");
  assert.equal(isCampusBased(m("3", "private-nonprofit", { unit_id: "3", series: {} }), 2014, 2024, campuses), true, "no share: campus-based");
  assert.equal(isCampusBased(m("4", "public", hist(2014, [0.95])), 2014, 2014, campuses), false, "a one-fall snapshot");
});

/* ---- Explore, profile, registration ---- */

test("Explore: online=campus|mostly, anything else ignored; one active filter; campus keeps colleges with no share", () => {
  assert.equal(parseFilters({ online: "campus" }).online, "campus");
  assert.equal(parseFilters({ online: "mostly" }).online, "mostly");
  assert.equal(parseFilters({ online: "all" }).online, undefined);
  assert.equal(parseFilters({}).online, undefined);
  assert.ok((FILTER_KEYS as readonly string[]).includes("online"));
  assert.equal(countActiveFilters({ online: "mostly" }), 1);
  const s = (v: number | null | undefined) => ({ demographics: { online_share: v } });
  assert.equal(matchesOnline(s(0.98), "mostly"), true);
  assert.equal(matchesOnline(s(0.5), "mostly"), false);
  assert.equal(matchesOnline(s(0.5), "campus"), true);
  assert.equal(matchesOnline(s(null), "campus"), true);
  assert.equal(matchesOnline(s(undefined), "mostly"), false);
  assert.equal(isMostlyOnline(s(0.51)), true);
});

test("profile line: shown from 5% entirely online; 'another X take some' only when that gap is 5% or more", () => {
  const s = (a: number | null, b: number | null) => ({ demographics: { online_share: a, online_any_share: b } });
  assert.deepEqual(onlineLine(s(0.19, 0.42)), { all: 0.19, some: 0.23 });
  assert.deepEqual(onlineLine(s(0.19, 0.22)), { all: 0.19, some: null });
  assert.equal(onlineLine(s(0.04, 0.6)), null);
  assert.equal(onlineLine(s(null, null)), null);
  assert.deepEqual(onlineLine(s(0.05, null)), { all: 0.05, some: null });
});

test("both fields are registered to the distance-education survey and cited on the Students page", () => {
  for (const f of ["demographics.online_share", "demographics.online_any_share"] as const) {
    assert.equal(FIELDS[f].source, "ipeds-ef-a-dist");
    assert.equal(FIELDS[f].vintage, "ipeds-ef-a-dist");
    assert.ok((TOPIC_FIELDS.students as readonly string[]).includes(f), f);
  }
  assert.deepEqual([...EFA_DIST_COLUMNS], ["EFDELEV", "EFDETOT", "EFDEEXC", "EFDESOM", "EFDENON"]);
  assert.equal(EFA_DIST_FIRST_YEAR, 2012);
});

/* ---- Stored values ---- */

test("stored values: nearly every college, shares within 0–1, at least one course ≥ every course, and the vintage is a fall", () => {
  const withShare = schools.filter((s) => s.demographics.online_share != null);
  assert.ok(withShare.length > 0.95 * schools.length, `${withShare.length} of ${schools.length} colleges`);
  for (const s of withShare) {
    const { online_share: a, online_any_share: b } = s.demographics;
    assert.ok(a! >= 0 && a! <= 1 && b! >= a! && b! <= 1, s.name);
  }
  assert.match(meta.vintages["ipeds-ef-a-dist"] ?? "", /^Fall \d{4}$/);
  assert.match(meta.sources["ipeds-ef-a-dist"]?.edition ?? "", /^Fall \d{4} \(EF\d{4}A_DIST\)$/);
  // Southern New Hampshire University is online-first; Vanderbilt is a campus.
  assert.ok(byId("183026").demographics.online_share! > 0.9);
  assert.ok(byId("221999").demographics.online_share! < 0.05);
});

test("the field rule reproduces the retired reviewed list for fall 2024 (110 public and nonprofit colleges)", { skip: meta.vintages["ipeds-ef-a-dist"] !== "Fall 2024" }, () => {
  const online = schools.filter((s) => s.type !== "private-forprofit" && isMostlyOnline(s));
  assert.equal(online.length, 110);
  for (const id of ["100812", "101453", "101587", "183026"]) assert.ok(online.some((s) => s.unit_id === id), id);
});

/* ---- Recomputed from NCES's file ---- */

const CACHED = join(ROOT, ".cache", "ipeds", "EF2024A_DIST.zip");

test("recomputed from the cached EF2024A_DIST: Southern New Hampshire ≈ 98% entirely online, Vanderbilt under 5%", { skip: !existsSync(CACHED) && "no cached EF2024A_DIST.zip (run npm run sync-data)" }, () => {
  const files = execFileSync("unzip", ["-Z1", CACHED], { encoding: "utf8" }).split("\n").filter((f) => /\.csv$/i.test(f));
  const csv = files.find((f) => /_rv\.csv$/i.test(f)) ?? files[0];
  const rows = parseCsv(execFileSync("unzip", ["-p", CACHED, csv], { encoding: "latin1", maxBuffer: 1024 * 1024 * 1024 }));
  // Without lib/online-share.ts: the all-undergraduates row (EFDELEV 2), every course ÷ total.
  const share = (id: string) => {
    const r = rows.find((x) => x.UNITID === id && Number(x.EFDELEV) === 2)!;
    assert.equal(Number(r.EFDEEXC) + Number(r.EFDESOM) + Number(r.EFDENON), Number(r.EFDETOT), `${id} adds up`);
    return Math.round((Number(r.EFDEEXC) / Number(r.EFDETOT)) * 10_000) / 10_000;
  };
  const snhu = share("183026");
  assert.ok(snhu > 0.96 && snhu < 0.995, `SNHU ${snhu}`);
  const vandy = share("221999");
  assert.ok(vandy < 0.05, `Vanderbilt ${vandy}`);
  if (meta.vintages["ipeds-ef-a-dist"] === "Fall 2024") {
    assert.equal(byId("183026").demographics.online_share, snhu);
    assert.equal(byId("221999").demographics.online_share, vandy);
  }
});
