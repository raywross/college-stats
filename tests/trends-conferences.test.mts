/**
 * Trends by athletic conference (specs/trends/conferences.md): the SEC recomputed straight from the shards (its 16
 * members fixed here, so a membership change in the data shows up as a test to review), the 8-member floor and the
 * 80% rule, football-only and unaffiliated codes, and conference slugs (unique, URL-safe, stable). The trend file is
 * the builder's over the mini fixture (tests/helpers/snapshot.mts miniTrendFile), where every conference has fewer
 * than 8 members: the SEC's membership is checked against the fixture's members of it, and its medians (the real
 * data's recompute from 16 shards) are left to the publisher's build over the full history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFERENCES, conferenceBySlug, isLeague } from "../lib/conferences.ts";
import type { ConferencesFile } from "../lib/trends.ts";
import { miniSchools, miniTrendFile } from "./helpers/snapshot.mts";

const file = await miniTrendFile<ConferencesFile>("conferences");
const MINI_IDS = new Set(miniSchools().map((s) => s.unit_id));

/** The SEC's members as of the 2025–26 survey: Oklahoma and Texas joined in 2024–25. */
const SEC = 130;
const SEC_IDS = [
  "100751", "100858", "106397", "134130", "139959", "157085", "159391", "176017",
  "176080", "178396", "207500", "218663", "221759", "221999", "228723", "228778",
];

test("the SEC's members are the 16 fixed here (those the mini fixture has), with Texas joining in 2024–25", () => {
  const sec = file.conferences.find((c) => c.code === SEC)!;
  const here = SEC_IDS.filter((id) => MINI_IDS.has(id));
  assert.ok(here.length >= 5, "Florida, Georgia, South Carolina, Vanderbilt, Texas A&M, Texas");
  assert.deepEqual([...sec.members].sort(), here.sort());
  // Oklahoma (207500) joined with Texas; the mini fixture doesn't carry it.
  assert.deepEqual(sec.joined, { "228778": 2024 });
  assert.ok(sec.moves.some((m) => m.unit_id === "228778" && m.joined && m.other === 108 && m.year === 2024), "Texas joined from the Big 12");
});

// (The real data's two recompute tests, the SEC's lines from its 16 shards and its ten-year applications change as
// the median member's own, need the 8-member floor met; every conference in the mini fixture is under it.)

test("the 8-member floor: smaller conferences are listed with no medians", () => {
  assert.equal(file.floor, 8);
  for (const c of file.conferences) {
    if (c.members.length < file.floor || c.footballOnly) {
      assert.equal(c.tooFew, true, c.name);
      assert.equal(c.lines, undefined, c.name);
      assert.equal(c.glance, undefined, c.name);
      assert.equal(c.change, undefined, c.name);
    } else {
      assert.equal(c.tooFew, undefined, c.name);
      assert.ok(c.lines && c.glance && c.change, c.name);
    }
  }
  // About 107 conferences have 8+ members in the real data; in the mini fixture, none does.
  assert.ok(file.conferences.length > 5 && file.conferences.every((c) => c.tooFew), "every conference here is under the floor");
});

test("a year under 80% reporting, or under the floor at the time, has no median", () => {
  for (const c of file.conferences) {
    if (!c.lines) continue;
    for (const meta of file.measures) {
      const line: (number | null)[] = c.lines[meta.key].atTheTime;
      // Before the conference series starts, membership at the time is unknown.
      for (let y = meta.from; y < file.membership.from; y++) assert.equal(line[y - meta.from], null, `${c.name} ${meta.key} ${y}`);
    }
  }
  assert.equal(file.coverage, 0.8);
});

test("independents and catch-all codes aren't conferences; football-only leagues are listed without medians", () => {
  for (const u of file.unaffiliated) {
    assert.equal(isLeague(u.code), false, u.name);
    assert.ok(!file.conferences.some((c) => c.code === u.code));
  }
  for (const c of file.conferences) assert.ok(isLeague(c.code), c.name);
  // The Frontier Conference, where Simpson University plays football (the real data's example was the Pioneer League).
  const frontier = file.conferences.find((c) => c.code === 352);
  assert.ok(frontier?.footballOnly && frontier.members.length === 0 && (frontier.footballMembers?.length ?? 0) > 0);
});

test("conference slugs are unique, URL-safe, and stable", () => {
  const slugs = Object.values(CONFERENCES).map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length, "unique");
  for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  // Stable: published URLs. A rename in a later IPEDS dictionary changes the name, never the slug.
  assert.equal(conferenceBySlug("southeastern-conference"), 130);
  assert.equal(conferenceBySlug("big-ten-conference"), 107);
  assert.equal(conferenceBySlug("big-twelve-conference"), 108);
  assert.equal(conferenceBySlug("atlantic-coast-conference"), 102);
  assert.equal(conferenceBySlug("summit-league"), 120);
  assert.equal(conferenceBySlug("nope"), null);
  for (const c of file.conferences) assert.equal(c.slug, CONFERENCES[c.code].slug);
});
