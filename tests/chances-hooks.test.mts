/**
 * The list row's inputs as the method reads them (lib/chances/hooks.ts; specs/chances/inputs-beyond-academics.md
 * "Legacy", "Recruited athlete", "Demonstrated interest"; method/standing.md "The other multipliers", "Floors"): every
 * ban row in data/reference/legacy-bans.json for both sectors (a ban makes legacy count for nothing whatever the
 * college's rating), the legacy and interest values by C7 rating, the recruited floors against every tier's cap, and
 * no telemetry of the toggles. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";
import type { School } from "../lib/types";

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});

const { HOOKS_V3, interestMultiplier, legacyMultiplier, recruitedFloor, recruitMultiplier } = await import("../lib/chances/hooks.ts");
const { LEGACY_BANS } = await import("../lib/chances/legacy-bans.ts");
const { SELECTIVITY_TIERS, STANDING_LEVELS } = await import("../lib/chances/levels.ts");
type SelectivityTier = import("../lib/chances/types.ts").SelectivityTier;

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

function school(state: string, type: School["type"], factors: Record<string, string> | null = null) {
  return { type, location: { state }, reported: factors ? { admission_profile: { factors } } : {} } as unknown as Pick<School, "type" | "location" | "reported">;
}

test("every ban row: legacy counts for nothing in each sector the state bans, and as the college rates it in a sector it doesn't", () => {
  assert.ok(LEGACY_BANS.bans.length >= 5);
  for (const ban of LEGACY_BANS.bans) {
    for (const type of ["public", "private-nonprofit", "private-forprofit"] as const) {
      const sector = type === "public" ? "public" : "private";
      const r = legacyMultiplier(school(ban.state, type, { alumni_relation: "very_important" }));
      if (ban.sectors.includes(sector)) {
        assert.equal(r.multiplier, 1, `${ban.state} ${type}: barred`);
        assert.equal(r.ban?.state, ban.state);
        assert.equal(r.rating, "very_important", "the rating is still read, for the sentence");
      } else {
        assert.equal(r.multiplier, 2.5, `${ban.state} ${type}: not barred`);
        assert.equal(r.ban, null);
      }
    }
  }
  // Guard: a state with no ban is never treated as barred.
  assert.equal(legacyMultiplier(school("MA", "private-nonprofit", { alumni_relation: "important" })).multiplier, 2.5);
});

test("legacy and interest follow the college's C7 rating; nothing without one", () => {
  const legacy = (rating: string | null) => legacyMultiplier(school("OH", "private-nonprofit", rating ? { alumni_relation: rating } : null)).multiplier;
  assert.deepEqual([legacy("very_important"), legacy("important"), legacy("considered"), legacy("not_considered"), legacy(null)], [2.5, 2.5, 1.5, 1, 1]);
  const interest = (rating: string | null) => interestMultiplier(school("OH", "private-nonprofit", rating ? { interest: rating } : null)).multiplier;
  assert.deepEqual([interest("very_important"), interest("important"), interest("considered"), interest("not_considered"), interest(null)], [1.15, 1.15, 1.05, 1, 1]);
  assert.equal(recruitMultiplier("contact"), HOOKS_V3.recruitContact);
  for (const pick of ["none", "pre_read", "likely_letter"] as const) assert.equal(recruitMultiplier(pick), 1, pick);
});

test("recruited floors against every tier: a likely letter is Likely anywhere; a positive pre-read Target at Elite and Likely elsewhere, from d ≥ −0.5", () => {
  const tiers: (SelectivityTier | null)[] = [...SELECTIVITY_TIERS, null];
  for (const tier of tiers) {
    assert.equal(recruitedFloor("likely_letter", null, tier), "likely", `${tier}: a likely letter needs no numbers`);
    assert.equal(recruitedFloor("likely_letter", -2, tier), "likely");
    assert.equal(recruitedFloor("pre_read", 0.3, tier), tier === "elite" ? "target" : "likely");
    assert.equal(recruitedFloor("pre_read", -0.5, tier), tier === "elite" ? "target" : "likely", "the boundary floors");
    assert.equal(recruitedFloor("pre_read", -0.51, tier), null, "below it, no floor");
    assert.equal(recruitedFloor("pre_read", null, tier), null, "no numbers to place: no floor");
    assert.equal(recruitedFloor("contact", 2, tier), null, "a contact multiplies; it isn't a floor");
    assert.equal(recruitedFloor("none", 2, tier), null);
  }
  // Every floor is a level, and never Safe (only a guarantee or open admission is).
  for (const f of [recruitedFloor("likely_letter", 0, "elite"), recruitedFloor("pre_read", 0, "selective")]) assert.ok(f && STANDING_LEVELS.includes(f) && f !== "safe");
});

test("the toggles never reach telemetry: no event registers legacy, recruited, or interest", () => {
  const analytics = read("lib", "analytics.ts");
  const registry = analytics.slice(analytics.indexOf("export const EVENTS"));
  const props = (src: string) => [...src.matchAll(/properties:\s*\[([^\]]*)\]/g)].flatMap((m) => m[1].split(",").map((p) => p.trim().replace(/"/g, "")));
  const leaks = (src: string) => props(src).filter((p) => /legacy|recruit|interest|hook/i.test(p));
  assert.ok(props(registry).length > 20);
  assert.deepEqual(leaks(registry), []);
  assert.deepEqual(leaks('e: { properties: ["group", "legacy"] }'), ["legacy"], "the check sees a leak");
});

test("hooks.ts is server-only and reads the bans only through banFor", () => {
  const src = read("lib", "chances", "hooks.ts");
  assert.match(src, /^import "server-only";/);
  assert.match(src, /import \{ banFor, sectorOf, type LegacyBan \} from "\.\/legacy-bans\.ts";/);
  assert.doesNotMatch(src, /legacy-bans\.json/);
});
