/**
 * State bans on legacy preference (specs/chances/inputs-beyond-academics.md "Legacy"; lib/chances/legacy-bans.ts):
 * every row in data/reference/legacy-bans.json resolves for both sectors it covers, a "private" ban covers both
 * private sectors, an unknown or unlisted state returns null, and the hand-kept table itself passes its own check
 * (and fails when broken). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES } from "../lib/states.ts";
import {
  banFor,
  banForSchool,
  LEGACY_BANS,
  sectorOf,
  validateLegacyBans,
  type LegacyBansFile,
} from "../lib/chances/legacy-bans.ts";

const KNOWN_STATES = new Set([...STATES.values()].map((s) => s.postal));

test("legacy-bans.json passes its own check", () => {
  assert.deepEqual(validateLegacyBans(LEGACY_BANS, KNOWN_STATES), []);
});

test("every row resolves for each sector it lists, and not for one it doesn't", () => {
  for (const row of LEGACY_BANS.bans) {
    for (const sector of row.sectors) {
      const ban = banFor(row.state, sector);
      assert.equal(ban?.state, row.state);
      assert.equal(ban?.law, row.law);
    }
    const missing = (["public", "private"] as const).filter((s) => !row.sectors.includes(s));
    for (const sector of missing) assert.equal(banFor(row.state, sector), null);
  }
});

test("lowercase and mixed-case state codes still resolve", () => {
  assert.notEqual(banFor("co", "public"), null);
  assert.notEqual(banFor("Co", "public"), null);
});

test("a state with no ban returns null for both sectors", () => {
  assert.equal(banFor("TX", "public"), null);
  assert.equal(banFor("TX", "private"), null);
  assert.equal(banFor("ZZ", "public"), null);
});

test("a ban covering \"private\" covers both private sectors via sectorOf", () => {
  assert.equal(sectorOf("private-nonprofit"), "private");
  assert.equal(sectorOf("private-forprofit"), "private");
  assert.equal(sectorOf("public"), "public");

  // Maryland's ban lists both sectors; both private school types resolve through sectorOf.
  const md = banFor("MD", sectorOf("private-nonprofit"));
  assert.equal(md?.state, "MD");
  const mdForProfit = banFor("MD", sectorOf("private-forprofit"));
  assert.equal(mdForProfit?.state, "MD");
});

test("California's ban covers private colleges only, not public", () => {
  assert.notEqual(banFor("CA", "private"), null);
  assert.equal(banFor("CA", "public"), null);
});

test("banForSchool resolves from a School-shaped record", () => {
  const privateInCalifornia = { type: "private-nonprofit" as const, location: { state: "CA" } };
  assert.notEqual(banForSchool(privateInCalifornia), null);
  const publicInCalifornia = { type: "public" as const, location: { state: "CA" } };
  assert.equal(banForSchool(publicInCalifornia), null);
  const publicInTexas = { type: "public" as const, location: { state: "TX" } };
  assert.equal(banForSchool(publicInTexas), null);
});

test("validateLegacyBans catches an unknown state, a bad sector, a bad date, and an unsorted table", () => {
  const broken: LegacyBansFile = {
    reviewed: "2026-10-11",
    bans: [
      { state: "ZZ", sectors: ["public", "both"] as never, effective: "not-a-date", law: "", source_url: "http://example.com" },
      { state: "AL", sectors: ["public"], effective: "2024-01-01", law: "SB 1", source_url: "https://example.com" },
    ],
  };
  const problems = validateLegacyBans(broken, KNOWN_STATES);
  assert.ok(problems.some((p) => p.includes("not a known USPS state code")));
  assert.ok(problems.some((p) => p.includes(`sectors may only hold "public" or "private"`)));
  assert.ok(problems.some((p) => p.includes("effective")));
  assert.ok(problems.some((p) => p.includes("law is required")));
  assert.ok(problems.some((p) => p.includes("source_url")));
  assert.ok(problems.some((p) => p.includes("sorted")));
});

test("validateLegacyBans rejects a duplicate state and a repeated sector", () => {
  const broken: LegacyBansFile = {
    reviewed: "2026-10-11",
    bans: [
      { state: "AL", sectors: ["public", "public"], effective: "2024-01-01", law: "SB 1", source_url: "https://example.com" },
      { state: "AL", sectors: ["private"], effective: "2024-01-01", law: "SB 2", source_url: "https://example.com" },
    ],
  };
  const problems = validateLegacyBans(broken, KNOWN_STATES);
  assert.ok(problems.some((p) => p.includes("one row per state")));
  assert.ok(problems.some((p) => p.includes("must not repeat")));
});
