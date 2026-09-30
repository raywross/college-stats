/**
 * Campus services and athletics (specs/data-expansion/campus-services.md): the IC2025 code rules, divisions from the
 * conference table, the table's own checks against colleges' NCAA/NAIA answers, the Explore filters, events, and the
 * stored values in data/schools.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import {
  apCreditFrom,
  athleticsFrom,
  calendarFrom,
  disabilityFrom,
  divisionFilterOf,
  divisionFrom,
  matchesServices,
  programsFrom,
  servicesFrom,
} from "../lib/campus-services.ts";
import { CONFERENCES, FBS_INDEPENDENTS, RETIRED_CONFERENCES, conferenceName } from "../lib/conferences.ts";
import { historyEvents } from "../lib/events.ts";
import { validateShard, type SchoolHistory } from "../lib/history.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

/** An IC row for an NCAA member playing all four sports, with `conf` for football and `other` for the rest. */
const ncaa = (football: number | null, other: number, extra: Record<string, string> = {}) => ({
  UNITID: "999999", ATHASSOC: "1", ASSOC1: "1", ASSOC2: "0",
  SPORT1: football === null ? "2" : "1", CONFNO1: football === null ? "-2" : String(football),
  SPORT2: "1", CONFNO2: String(other), SPORT3: "1", CONFNO3: String(other), SPORT4: "1", CONFNO4: String(other),
  ...extra,
});

test("divisions come from the main conference; FBS vs FCS from football's", () => {
  assert.equal(divisionFrom(ncaa(130, 130)), "I-FBS", "SEC");
  assert.equal(divisionFrom(ncaa(128, 104)), "I-FCS", "Georgetown: Big East, Patriot League football");
  assert.equal(divisionFrom(ncaa(123, 123)), "I-FCS", "123 in football is the Missouri Valley Football Conference");
  assert.equal(divisionFrom(ncaa(113, 102)), "I-FBS", "Notre Dame: ACC, FBS independent football");
  assert.equal(divisionFrom(ncaa(null, 104)), "I", "Division I without football");
  assert.equal(divisionFrom(ncaa(158, 158)), "II");
  assert.equal(divisionFrom(ncaa(185, 185)), "III");
  assert.equal(divisionFrom({ ...ncaa(309, 309), ASSOC1: "0", ASSOC2: "1" }), null, "NAIA members have no NCAA division");
  assert.equal(divisionFrom(ncaa(342, 342)), null, '"Other" says nothing');
  // 112 holds FCS and FBS independents alike; FBS ones are listed by hand.
  assert.equal(divisionFrom(ncaa(112, 104)), "I-FCS");
  const uconn = Object.keys(FBS_INDEPENDENTS)[0];
  assert.equal(divisionFrom(ncaa(112, 104, { UNITID: uconn })), "I-FBS");
});

test("athletics keep the main conference, and football's only when it differs", () => {
  const a = athleticsFrom(ncaa(128, 104))!;
  assert.deepEqual(a.conference, { code: 104, name: "Big East Conference" });
  assert.deepEqual(a.football_conference, { code: 128, name: "Patriot League" });
  assert.deepEqual(a.sports, ["football", "basketball", "baseball", "track"]);
  assert.equal(athleticsFrom(ncaa(130, 130))!.football_conference, null);
  assert.deepEqual(athleticsFrom({ ATHASSOC: "2" }), { associations: [], division: null, conference: null, football_conference: null, sports: [] });
  assert.equal(athleticsFrom({ ATHASSOC: "-2" }), null);
  assert.equal(athleticsFrom(undefined), null);
});

test("programs, services, AP credit, calendar, and disability services follow the IC2025 dictionary", () => {
  const row = { SLO5: "1", SLO51: "1", SLO52: "0", SLO53: "1", SLO6: "1", SLOA: "0", SLOB: "1", STUSRV2: "1", STUSRV3: "0", STUSRV4: "1", STUSRV8: "0" };
  assert.deepEqual(programsFrom(row), { rotc: ["army", "air_force"], study_abroad: true, undergrad_research: false, intellectual_disability_program: true });
  assert.equal(programsFrom({ ...row, SLOA: undefined as unknown as string })!.undergrad_research, null, "not asked before IC2022");
  assert.deepEqual(programsFrom({ ...row, SLO5: "0" })!.rotc, [], "branches only count under SLO5");
  assert.equal(programsFrom({ SLO5: "-2", SLO6: "-2" }), null);
  assert.deepEqual(servicesFrom(row), { counseling: true, employment: false, placement: true, child_care: false });
  assert.equal(apCreditFrom({ CREDITS3: "1" }), true);
  assert.equal(apCreditFrom({ CREDITS3: "0" }), false, "implied no");
  assert.equal(apCreditFrom({ CREDITS3: "-2" }), null);
  assert.equal(calendarFrom({ CALSYS: "4" }), "4-1-4");
  assert.equal(calendarFrom({ CALSYS: "-2" }), null);
  assert.deepEqual(disabilityFrom({ DISAB: "2", DISABPCT: "15.00" }), { share: 0.15 });
  assert.deepEqual(disabilityFrom({ DISAB: "1", DISABPCT: "" }), { three_or_less: true });
  assert.equal(disabilityFrom({ DISAB: "2", DISABPCT: "" }), null, "over 3% without the number");
  assert.equal(disabilityFrom({ DISAB: "-2" }), null);
});

test("every stored conference is in the table, and NCAA vs NAIA levels agree with members' own answers", () => {
  const members = new Map<number, { ncaaOnly: number; naiaOnly: number; n: number }>();
  for (const s of schools) {
    const a = s.campus?.athletics;
    for (const c of [a?.conference, a?.football_conference]) {
      if (!c) continue;
      assert.ok(CONFERENCES[c.code], `${s.name}: conference ${c.code} is in the table`);
      assert.equal(c.name, CONFERENCES[c.code].name);
      const m = members.get(c.code) ?? { ncaaOnly: 0, naiaOnly: 0, n: 0 };
      m.n++;
      if (a!.associations.includes("ncaa") && !a!.associations.includes("naia")) m.ncaaOnly++;
      if (a!.associations.includes("naia") && !a!.associations.includes("ncaa")) m.naiaOnly++;
      members.set(c.code, m);
    }
  }
  for (const [code, m] of members) {
    const level = CONFERENCES[code].level;
    if (level === "NAIA") assert.equal(m.ncaaOnly, 0, `${CONFERENCES[code].name}: NAIA, but ${m.ncaaOnly} NCAA-only members`);
    else if (level !== null) assert.equal(m.naiaOnly, 0, `${CONFERENCES[code].name}: NCAA, but ${m.naiaOnly} NAIA-only members`);
  }
  for (const code of Object.keys(RETIRED_CONFERENCES)) assert.ok(!CONFERENCES[Number(code)], `${code} is either current or retired`);
});

test("the table's member check fails when a level is wrong", () => {
  // Proof the guard above bites: the Big Ten's members are all NCAA-only, so calling it NAIA would fail.
  const bigTen = schools.filter((s) => s.campus?.athletics?.conference?.code === 107);
  assert.ok(bigTen.length >= 15);
  assert.ok(bigTen.every((s) => s.campus!.athletics!.associations.includes("ncaa") && !s.campus!.athletics!.associations.includes("naia")));
});

test("services filters parse from the URL and match", () => {
  const f = parseFilters({ division: "I-FBS,naia,IV", conference: "130", football: "1", rotc: "navy,marines", ugResearch: "1", studyAbroad: "1" });
  assert.deepEqual(f.division, ["I-FBS", "naia"]);
  assert.equal(f.conference, 130);
  assert.deepEqual(f.rotc, ["navy"]);
  assert.equal(parseFilters({ conference: "9999" }).conference, undefined, "unknown codes are ignored");
  assert.equal(parseFilters({ conference: "1e3" }).conference, undefined);
  assert.equal(countActiveFilters({ division: "II", rotc: "army" }), 2);

  const vu = schools.find((s) => s.unit_id === "221999")!;
  assert.ok(matchesServices(vu, { division: ["I-FBS"], conference: 130, football: true, rotc: ["navy"], ugResearch: true, studyAbroad: true }));
  assert.ok(!matchesServices(vu, { division: ["III"] }));
  const gt = schools.find((s) => s.unit_id === "131496")!;
  assert.ok(matchesServices(gt, { conference: 128 }), "football's conference counts too");
  assert.ok(!matchesServices({ campus: undefined }, { football: true }), "unreported never matches");
});

test("conference, association, and ROTC events read like the news", () => {
  const h = (series: SchoolHistory["series"]): SchoolHistory => ({ unit_id: "1", series });
  const ev = (x: SchoolHistory) => historyEvents(x).map((e) => `${e.year}: ${e.text}`);
  assert.deepEqual(ev(h({ conference: { start: 2022, values: [127, 127, 107] }, football_conference: { start: 2022, values: [127, 127, 107] } })), [
    "2024: Moved from the Pacific-12 Conference to the Big Ten Conference",
  ], "a football move with the rest of the college is one event");
  assert.deepEqual(ev(h({ conference: { start: 2019, values: [104, 104, 104, 104, 104] }, football_conference: { start: 2019, values: [104, 104, 104, 104, 112] } })), [], "UConn listing its home conference for football, then independent, is a fix, not a move");
  assert.deepEqual(ev(h({ football_conference: { start: 2019, values: [114, 113] } })), ["2020: Football moved up to FBS as an independent"]);
  assert.deepEqual(ev(h({ athletic_association: { start: 2020, values: [2, 2, 1] } })), ["2022: Moved from the NAIA to the NCAA"]);
  assert.deepEqual(ev(h({ rotc: { start: 2020, values: [2, 2, 1, 1] } })), ["2022: Began offering ROTC"]);
  assert.deepEqual(ev(h({ rotc: { start: 2020, values: [1, 2, 1] } })), [], "a one-year gap is a reporting slip");
});

test("history accepts known conference codes only", () => {
  assert.deepEqual(validateShard({ unit_id: "1", series: { conference: { start: 2015, values: [209, 107] } } }), [], "retired 209 has a name");
  assert.equal(conferenceName(209), "Heartland Conference");
  assert.equal(validateShard({ unit_id: "1", series: { conference: { start: 2015, values: [999] } } }).length, 1);
});

test("stored athletics and programs are plausible", () => {
  const fbs = schools.filter((s) => s.campus?.athletics?.division === "I-FBS").length;
  assert.ok(fbs >= 125 && fbs <= 140, `about 136 FBS programs, got ${fbs}`);
  const vu = schools.find((s) => s.unit_id === "221999")!;
  assert.equal(vu.campus!.athletics!.conference!.name, "Southeastern Conference");
  assert.equal(divisionFilterOf(vu), "I-FBS");
  assert.equal(schools.find((s) => s.unit_id === "129020")!.campus!.athletics!.division, "I-FBS", "UConn");
  assert.equal(schools.find((s) => s.unit_id === "166027")!.campus!.athletics!.division, "I-FCS", "Harvard (Ivy League)");
  const withAthletics = schools.filter((s) => s.campus?.athletics).length;
  assert.ok(withAthletics > 0.95 * schools.length);
  for (const s of schools) {
    const d = s.demographics.disability_services;
    if (d && "share" in d) assert.ok(d.share > 0.03 && d.share <= 1, `${s.name}: share over 3%`);
  }
});
