/**
 * The CDS template table, year rules, normalizers, and model schema (lib/cds-sections.ts,
 * specs/college-reported-round-3.md Decisions 2–4). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import {
  codesFor,
  compareCodes,
  isPlaceholder,
  itemOfCode,
  loadTemplate,
  maxTokensFor,
  monthDay,
  normalizeValue,
  parseAidYear,
  parseEdition,
  readMark,
  schemaFor,
  SCHEMA_VERSIONS,
  storeOnlyCodes,
  typeFailure,
  yearsForEdition,
  type TemplateFile,
  type ValueType,
} from "../lib/cds-sections.ts";
import file from "../data/reference/cds-template-2025-26.json" with { type: "json" };

const T = CDS_TEMPLATE;

/* ---- The template table ---- */

test("the 2025–26 table has every template code once, in template order", () => {
  assert.equal(T.items.length, 1105);
  assert.equal(T.byCode.size, 1105);
  const codes = T.items.map((it) => it.code);
  assert.deepEqual([...codes].sort(compareCodes), codes);
  assert.equal(codes[0], "A.001");
  assert.equal(codes.at(-1), "J.220");
});

test("model and store-only totals: C matches the spec's 263; the six F1 age codes are store-only (As built)", () => {
  assert.equal(codesFor(T, "C").length, 263);
  assert.equal(codesFor(T, "rest").length, 497);
  assert.equal(storeOnlyCodes(T).length, 345);
  // The spec's 503/339 counted F.101–F.116 whole while marking age store-only; the difference is exactly those six.
  const age = ["F.106", "F.107", "F.108", "F.114", "F.115", "F.116"];
  for (const c of age) assert.equal(T.byCode.get(c)!.call, "store", c);
  assert.equal(codesFor(T, "rest").length + age.length, 503);
});

test("every model code has an owner and every store-only code has none", () => {
  for (const it of T.items) {
    if (it.call === "store") assert.equal(it.owner, null, it.code);
    else assert.ok(it.owner, it.code);
    if (it.call === "C") assert.equal(it.section, "C", it.code);
    if (it.call === "rest") assert.notEqual(it.section, "C", it.code);
  }
});

test("items derive from codes, with H0 and section J special", () => {
  assert.equal(itemOfCode("C.101"), "C1");
  assert.equal(itemOfCode("C.1201"), "C12");
  assert.equal(itemOfCode("H.2A01"), "H2A");
  assert.equal(itemOfCode("C.8D"), "C8D");
  assert.equal(itemOfCode("C.8G03"), "C8G");
  assert.equal(itemOfCode("B.2201"), "B22");
  assert.equal(itemOfCode("H.101"), "H0");
  assert.equal(itemOfCode("H.105"), "H1");
  assert.equal(itemOfCode("J.199"), "J");
  assert.equal(T.byItem.get("C1")!.length, 30);
  assert.equal(T.byItem.get("H0")!.length, 4);
});

test("scope rows land where the spec puts them", () => {
  const at = (c: string) => T.byCode.get(c)!;
  assert.equal(at("C.116").owner, "college-reported-data");
  assert.equal(at("C.119").owner, "cds-residency-admissions");
  assert.equal(at("C.8E01").call, "store");
  assert.equal(at("C.8F").call, "C");
  assert.equal(at("F.101").owner, "residence");
  assert.equal(at("F.102").owner, "greek-life");
  assert.equal(at("F.104").owner, "housing-and-policies");
  assert.equal(at("F.201").owner, "religious-life");
  assert.equal(at("F.408").owner, "greek-life");
  assert.deepEqual(at("C.715").also, ["religious-life"]);
  assert.equal(at("H.401").owner, "cds-cost-and-debt");
  assert.equal(at("J.101").call, "store");
  assert.equal(at("I.101").call, "store");
  assert.equal(at("H.101").tag, "ACAD_YR");
});

test("value types: scores, GPA, and shares are told apart from the template's mixed column", () => {
  const vt = (c: string) => T.byCode.get(c)!.value_type;
  const expect: [string, ValueType][] = [
    ["C.905", "sat-composite"], ["C.908", "sat-section"], ["C.914", "act"], ["C.923", "act-writing"],
    ["C.901", "percent"], ["C.1101", "percent"], ["C.1201", "gpa"], ["C.116", "count"], ["B.2201", "count"],
    ["G.101", "currency"], ["C.1402", "month"], ["C.1403", "day"], ["C.1608", "date"], ["C.701", "choice"],
    ["E.110", "check"], ["C.2101", "yes-no"], ["F.107", "decimal"], ["I.201", "decimal"],
  ];
  for (const [code, t] of expect) assert.equal(vt(code), t, code);
});

test("loadTemplate refuses a malformed table", () => {
  const bad = (patch: Record<string, unknown>) => {
    const f = structuredClone(file) as TemplateFile;
    Object.assign(f.items[300], patch);
    return () => loadTemplate(f);
  };
  assert.throws(bad({ code: "C101" }), /malformed code/);
  assert.throws(bad({ value_type: "money" }), /unknown value_type/);
  assert.throws(bad({ year_rule: "someday" }), /unknown year_rule/);
  assert.throws(bad({ call: "store", owner: "cds-admissions" }), /store-only but owned/);
  assert.throws(bad({ call: "C", owner: null }), /no owner/);
  const dup = structuredClone(file) as TemplateFile;
  dup.items.push(dup.items[0]);
  assert.throws(() => loadTemplate(dup), /duplicate code/);
});

/* ---- Editions and years ---- */

test("editions parse in every spelling", () => {
  for (const s of ["2025-26", "2025–26", "2025-2026", "2025 - 2026"]) assert.deepEqual(parseEdition(s), { start: 2025, key: "2025-26" }, s);
  for (const s of ["2025-27", "2025", "Fall 2025", ""]) assert.equal(parseEdition(s), null, s);
});

test("year rules for the 2025–26 edition, exactly as the spec lists them", () => {
  const y = yearsForEdition("2025-26", { aidYear: "2024-2025 Final" });
  assert.deepEqual(y, {
    edition: "2025–26",
    fall: "Fall 2025", // C1–C12
    "test-policy-cycle": "Fall 2027 applicants", // C8: applying for Fall 2027
    "next-cycle": "Fall 2026 cycle", // C13–C18
    "next-year": "2026–27", // G
    "aid-year": "2024–25 final", // H1, H2, H2A, H6 from H.101
    "graduating-class": "Class of 2025", // H4–H5
    cohort: "Fall 2019 cohort", // B4–B11
    "previous-cohort": "Fall 2018 cohort", // B5
    retention: "Fall 2024 cohort to Fall 2025", // B22
    "prior-year": "2024–25", // B3, J
  });
  assert.deepEqual(yearsForEdition("2025–26"), yearsForEdition("2025-2026"));
});

test("the aid year is read from H.101 and differs by college", () => {
  assert.equal(yearsForEdition("2025-26", { aidYear: "2025-2026 Estimated" })["aid-year"], "2025–26 estimated");
  assert.deepEqual(parseAidYear("2025-26 Est."), { start: 2025, status: "estimated" });
  assert.deepEqual(parseAidYear("2024–2025 final"), { start: 2024, status: "final" });
  // Howard's "2023" and a blank have no year, so the aid group gets none (and can't publish).
  assert.equal(parseAidYear("2023"), null);
  assert.equal(yearsForEdition("2025-26", { aidYear: "2023" })["aid-year"], undefined);
  assert.equal(yearsForEdition("2025-26", { aidYear: null })["aid-year"], undefined);
});

test("every template year rule produces a label", () => {
  const y = yearsForEdition("2025-26", { aidYear: "2024-2025 Final" });
  for (const it of T.items) assert.ok(y[it.year_rule], `${it.code} ${it.year_rule}`);
  assert.throws(() => yearsForEdition("Fall 2025"), /not a CDS edition/);
});

/* ---- Normalizers ---- */

const N = (value_type: ValueType, raw: unknown, excel = false) => normalizeValue({ value_type }, raw, { excel });

test("percents: fractions, percents, percent signs, doubled signs", () => {
  assert.deepEqual(N("percent", 0.274), { status: "value", v: 0.274 });
  assert.deepEqual(N("percent", 27.4), { status: "value", v: 0.274 });
  assert.deepEqual(N("percent", "27.4%"), { status: "value", v: 0.274 });
  assert.deepEqual(N("percent", "1%%"), { status: "value", v: 0.01 }); // UIUC F1
  assert.deepEqual(N("percent", 63.73), { status: "value", v: 0.6373 }); // Loyola B
  assert.deepEqual(N("percent", "0.61"), { status: "value", v: 0.61 }); // Howard's 0.61% can't be told per value
  assert.deepEqual(N("percent", 1.0001), { status: "value", v: 1.0001 }); // a total, not 1%
  assert.deepEqual(N("percent", "varies"), { status: "text", v: "varies" });
});

test("checked glyphs and yes/no", () => {
  for (const s of ["X", "x", "✔", "☒", "Yes", "Y", ""]) assert.deepEqual(N("check", s), { status: "value", v: true }, s);
  assert.deepEqual(N("check", "☐"), { status: "blank", v: null }); // unchecked is blank, never false
  assert.deepEqual(N("check", "No"), { status: "value", v: false });
  assert.deepEqual(N("check", "Same fee"), { status: "text", v: "Same fee" }); // a choice typed in an x cell
  assert.deepEqual(N("yes-no", "Yes"), { status: "value", v: true });
  assert.deepEqual(N("yes-no", "N"), { status: "value", v: false });
  assert.equal(readMark("maybe"), null);
});

test("blanks and placeholders are blank, never 0 or false", () => {
  for (const s of ["", " ", "-", "–", "N/A", "n/a", "N/Av", "Not Applicable", "XXXXX", "Yes or No", null, undefined]) {
    assert.deepEqual(N("count", s), { status: "blank", v: null }, String(s));
  }
  assert.deepEqual(N("yes-no", "Yes or No"), { status: "blank", v: null }); // Cornell's C21 placeholder isn't yes
  assert.equal(isPlaceholder("None"), false);
  assert.deepEqual(N("count", 0), { status: "value", v: 0 }); // a real zero stays
});

test("dates: month/day text, Excel serials, and what isn't a date", () => {
  assert.deepEqual(monthDay("11/1"), { month: 11, day: 1 });
  assert.deepEqual(monthDay("1-Nov"), { month: 11, day: 1 });
  assert.deepEqual(monthDay("Nov 1st"), { month: 11, day: 1 });
  assert.deepEqual(monthDay("Feb. 15"), { month: 2, day: 15 });
  assert.deepEqual(monthDay("December 1"), { month: 12, day: 1 });
  assert.deepEqual(monthDay("--04-01"), { month: 4, day: 1 });
  assert.deepEqual(monthDay(46113, { excel: true }), { month: 4, day: 1 }); // William & Mary's C16 "Other"
  assert.deepEqual(monthDay("46113", { excel: true }), { month: 4, day: 1 });
  assert.equal(monthDay(46113), null); // a serial only means a date in a workbook cell
  for (const s of ["11 months 1 day", "mid-Dec", "Early April", "2/30", "13/1", "Nov"]) assert.equal(monthDay(s), null, s);
  assert.deepEqual(N("date", 46113, true), { status: "value", v: "--04-01" });
  assert.deepEqual(N("date", "Early April"), { status: "text", v: "Early April" });
  assert.deepEqual(N("month", "Nov"), { status: "value", v: 11 });
  assert.deepEqual(N("day", 15), { status: "value", v: 15 });
});

test("split digits are joined; ## totals are flagged for summing; text stays text", () => {
  assert.deepEqual(N("currency", "$3 4 , 604"), { status: "value", v: 34604 }); // Georgia Tech
  assert.deepEqual(N("count", "##"), { status: "overflow", v: null }); // Loyola
  assert.deepEqual(N("percent", "###"), { status: "overflow", v: null });
  assert.deepEqual(N("currency", "$50/$75"), { status: "text", v: "$50/$75" });
  assert.deepEqual(N("decimal", "45-60"), { status: "text", v: "45-60" });
  assert.deepEqual(N("text", "2 Year"), { status: "value", v: "2 Year" });
  assert.deepEqual(N("text", 46096), { status: "value", v: "46096" });
});

test("the universal type checks", () => {
  const F = (value_type: ValueType, v: unknown) => typeFailure({ value_type }, v)?.check ?? null;
  assert.equal(F("count", 0.97), "type-range"); // Vanderbilt's B22 cohort
  assert.equal(F("count", -1), "type-range");
  assert.equal(F("count", 3525), null);
  assert.equal(F("percent", 1.5), "type-range");
  assert.equal(F("percent", 1.0001), null);
  assert.equal(F("gpa", 4.34), null);
  assert.equal(F("gpa", 93), "type-range");
  assert.equal(F("sat-section", 810), "type-range");
  assert.equal(F("sat-composite", 1442), null);
  assert.equal(F("act", 37), "type-range");
  assert.equal(F("act", 32.3), null);
  assert.equal(F("month", 13), "type-range");
  assert.equal(F("day", 0), "type-range");
  assert.equal(F("count", "varies"), null); // text is kept, not range-checked
});

/* ---- The model schema ---- */

test("the schema has only the call's model codes, all optional, additionalProperties false everywhere", () => {
  for (const call of ["C", "rest"] as const) {
    const schema = schemaFor(T, call);
    const keys = Object.keys(schema.properties);
    assert.deepEqual(keys, codesFor(T, call));
    assert.equal(schema.additionalProperties, false);
    assert.equal("required" in schema, false);
    const store = new Set(storeOnlyCodes(T));
    for (const k of keys) assert.ok(!store.has(k), `${k} is store-only`);
    // Walk every object in the schema.
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") assert.equal(n.additionalProperties, false, path);
      for (const banned of ["minimum", "maximum", "maxLength", "minLength", "pattern"]) assert.equal(banned in n, false, `${path}.${banned}`);
      for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
    };
    walk(schema, call);
    assert.deepEqual(schema.properties["C.116" in schema.properties ? "C.116" : "H.105"].required, ["v", "lines"]);
  }
  assert.deepEqual(SCHEMA_VERSIONS, { C: 1, rest: 1 });
  assert.equal(maxTokensFor("C"), 8192);
  assert.equal(maxTokensFor("rest"), 16384);
});
