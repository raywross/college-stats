/**
 * The plan's color tokens (lib/planner/colors.ts, app/globals.css; specs/planner/redesign/calendar.md "Colors"):
 * every variable colors.ts names is defined in both themes with calendar.md's values, and the design preview reads
 * the same tokens. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GROUP_CLASS, KID_VARS, MONEY_VAR, ROUND_VAR, TEST_VAR } from "../lib/planner/colors.ts";
import { STANDING_LEVELS } from "../lib/chances/levels.ts";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} block`);
  return css.slice(start, css.indexOf("\n}", start));
};
const light = block(":root");
const dark = block(".dark");
const value = (b: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(b)?.[1].trim() ?? null;
const varName = (v: string) => /^var\(--([\w-]+)\)$/.exec(v)?.[1] ?? "";

test("every plan color variable is defined in the light and dark themes", () => {
  for (const v of [...Object.values(ROUND_VAR), TEST_VAR, MONEY_VAR, ...KID_VARS]) {
    const name = varName(v);
    assert.ok(name, v);
    assert.ok(value(light, name), `--${name} missing in :root`);
    assert.ok(value(dark, name), `--${name} missing in .dark`);
  }
});

test("calendar.md's values: RD blue, ED orange, EA aqua; ED II and REA share their family's color", () => {
  assert.equal(value(light, "round-rd"), "#2a78d6");
  assert.equal(value(dark, "round-rd"), "#3987e5");
  assert.equal(value(light, "round-ed"), "#eb6834");
  assert.equal(value(dark, "round-ed"), "#d95926");
  assert.equal(value(light, "round-ea"), "#1baf7a");
  assert.equal(value(dark, "round-ea"), "#199e70");
  for (const b of [light, dark]) {
    assert.equal(value(b, "round-ed2"), value(b, "round-ed"));
    assert.equal(value(b, "round-rea"), value(b, "round-ea"));
    assert.equal(value(b, "round-rolling"), value(b, "round-rd"));
  }
  assert.equal(value(light, "plan-test"), "#4a3aa7");
  assert.equal(value(dark, "plan-test"), "#9085e9");
  assert.equal(value(light, "plan-money"), "#008300");
});

test("levels.md: the five level chips exist, plus the empty group", () => {
  for (const level of STANDING_LEVELS) assert.ok(GROUP_CLASS[level], `GROUP_CLASS missing ${level}`);
  assert.ok(GROUP_CLASS.unsorted);
});

test("levels.md 'Chip colors': High reach is never red or orange", () => {
  assert.ok(!/\bred\b|\borange\b/.test(GROUP_CLASS.high_reach), `High reach chip reads a warning color: ${GROUP_CLASS.high_reach}`);
});

test("levels.md 'Chip colors': Safe is apart from Likely (a different hue family, deeper)", () => {
  assert.notEqual(GROUP_CLASS.safe, GROUP_CLASS.likely);
  // Likely stays emerald; Safe moves to a separate green family so the two read apart, not just lighter/darker.
  assert.ok(GROUP_CLASS.likely.includes("emerald"));
  assert.ok(GROUP_CLASS.safe.includes("green") && !GROUP_CLASS.safe.includes("emerald"));
});
