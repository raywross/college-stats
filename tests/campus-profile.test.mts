/**
 * Campus profile (specs/data-expansion/campus-profile.md): the HD2025 code rules, Scorecard designation flags, the
 * Explore filters, and the stored values in data/schools.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { campusProfileFrom, designationsOf, matchesCampus, msiFrom } from "../lib/campus-profile.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { parseCsv } from "../scripts/lib/ipeds.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

test("parseCsv strips a byte-order mark so the first column keeps its name", () => {
  // HD2025 starts with one; left in, UNITID became "﻿UNITID" and no row matched.
  assert.deepEqual(parseCsv("﻿UNITID,LOCALE\r\n221999,11\r\n"), [{ UNITID: "221999", LOCALE: "11" }]);
  assert.deepEqual(parseCsv("ï»¿UNITID,LOCALE\n1,21\n"), [{ UNITID: "1", LOCALE: "21" }], "a BOM read as Latin-1");
});

test("the directory row follows the HD2025 dictionary codes", () => {
  const p = campusProfileFrom({
    LOCALE: "11", CARNEGIEIC: "6", CARNEGIERSCH: "1", CARNEGIESAEC: "5", CARNEGIESIZE: "4",
    HBCU: "2", TRIBAL: "2", LANDGRNT: "1", LATITUDE: "36.144", LONGITUD: "-86.803",
  });
  assert.deepEqual(p.setting, { locale: 11, label: "City: Large", group: "city" });
  assert.deepEqual(p.carnegie, {
    ic: "Mixed Undergraduate/Graduate-Doctorate Large", research: "R1",
    access_earnings: "Lower Access, Higher Earnings", size: "Large",
  });
  assert.deepEqual(p.designations, ["land_grant"]);
  assert.deepEqual([p.lat, p.lng], [36.144, -86.803]);

  assert.equal(campusProfileFrom({ LOCALE: "43" }).setting!.group, "rural");
  assert.equal(campusProfileFrom({ LOCALE: "-3" }).setting, null, "not applicable is null");
  assert.equal(campusProfileFrom({ CARNEGIEIC: "-2", CARNEGIERSCH: "1" }).carnegie, null, "outside the Carnegie universe");
  assert.equal(campusProfileFrom({ CARNEGIEIC: "22", CARNEGIERSCH: "0" }).carnegie!.research, null, "0 is no research tier");
  assert.deepEqual(campusProfileFrom({ HBCU: "1", TRIBAL: "1" }).designations, ["hbcu", "tribal"]);
  assert.deepEqual(campusProfileFrom({ LATITUDE: "0", LONGITUD: "0" }).lat, 0, "0 latitude is in range");
  assert.equal(campusProfileFrom({ LATITUDE: "40", LONGITUD: "10" }).lng, null, "a longitude outside the U.S. is dropped");
  assert.deepEqual(campusProfileFrom(undefined), { setting: null, carnegie: null, designations: [], lat: null, lng: null });
});

test("Scorecard flags become designations only when set to 1", () => {
  assert.deepEqual(msiFrom({ "school.minority_serving.hispanic": 1, "school.women_only": 1, "school.men_only": 0, "school.minority_serving.aanipi": null }), ["hsi", "women"]);
  assert.deepEqual(msiFrom({}), []);
});

test("campus filters parse from the URL and match any chosen value", () => {
  const f = parseFilters({ setting: "city,town,nowhere", research: "R1", designation: "hbcu,hsi,hbcu" });
  assert.deepEqual(f.setting, ["city", "town"], "unknown values are dropped");
  assert.deepEqual(f.research, ["R1"]);
  assert.deepEqual(f.designation, ["hbcu", "hsi"], "duplicates are dropped");
  assert.equal(countActiveFilters({ setting: "city", research: "R1,R2" }), 2);

  const s = { campus: { setting: { locale: 31, label: "Town: Fringe", group: "town" }, carnegie: { ic: null, research: "R2", access_earnings: null, size: null }, designations: [], msi: ["hsi"] } } as Pick<School, "campus">;
  assert.ok(matchesCampus(s, { setting: ["city", "town"] }));
  assert.ok(!matchesCampus(s, { research: ["R1"] }));
  assert.ok(matchesCampus(s, { designation: ["hbcu", "hsi"] }));
  assert.ok(!matchesCampus({ campus: undefined }, { setting: ["city"] }), "unreported never matches");
  assert.ok(matchesCampus({ campus: undefined }, {}), "no filters match everything");
});

test("stored campus profiles are consistent", () => {
  const withSetting = schools.filter((s) => s.campus?.setting);
  assert.ok(withSetting.length > 0.95 * schools.length, "nearly every college has a setting");
  for (const s of withSetting) assert.equal(s.campus!.setting!.group, ["city", "suburb", "town", "rural"][Math.floor(s.campus!.setting!.locale / 10) - 1]);
  const r1 = schools.filter((s) => s.campus?.carnegie?.research === "R1").length;
  assert.ok(r1 > 150 && r1 < 220, `about 187 R1 universities under Carnegie 2025, got ${r1}`);
  for (const s of schools) assert.equal(new Set(designationsOf(s)).size, designationsOf(s).length, `${s.name}: no repeated designation`);

  const vu = schools.find((s) => s.unit_id === "221999")!;
  assert.equal(vu.campus!.setting!.group, "city");
  assert.equal(vu.campus!.carnegie!.research, "R1");
  const howard = schools.find((s) => s.unit_id === "131520")!;
  assert.ok(designationsOf(howard).includes("hbcu"), "Howard is an HBCU");
});
