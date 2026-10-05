/**
 * Trends by athletic conference (specs/trends/conferences.md): the SEC recomputed straight from the shards (its 16
 * members fixed here, so a membership change in the data shows up as a test to review), the 8-member floor and the
 * 80% rule, football-only and unaffiliated codes, and conference slugs (unique, URL-safe, stable).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFERENCES, conferenceBySlug, isLeague } from "../lib/conferences.ts";
import type { CpiTable, HistoryMeta, SchoolHistory, SeriesKey } from "../lib/history.ts";
import type { ConferencesFile } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const read = <T,>(p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;
const file = read<ConferencesFile>("data/history/trends/conferences.json");
const hmeta = read<HistoryMeta>("data/history/meta.json");
const cpi = read<CpiTable>("data/history/cpi.json");
const shard = (id: string) => read<SchoolHistory>(`data/history/schools/${id}.json`);

/** The SEC's members as of the 2025–26 survey: Oklahoma and Texas joined in 2024–25. */
const SEC = 130;
const SEC_IDS = [
  "100751", "100858", "106397", "134130", "139959", "157085", "159391", "176017",
  "176080", "178396", "207500", "218663", "221759", "221999", "228723", "228778",
];

const val = (h: SchoolHistory, k: SeriesKey, y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? s.values[y - s.start] : null;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
};
const cpiAt = (y: number) => cpi.values[y - cpi.start];

test("the SEC's members are the 16 fixed here, with Oklahoma and Texas joining in 2024–25", () => {
  const sec = file.conferences.find((c) => c.code === SEC)!;
  assert.deepEqual([...sec.members].sort(), [...SEC_IDS].sort());
  assert.deepEqual(sec.joined, { "207500": 2024, "228778": 2024 });
  assert.ok(sec.moves.some((m) => m.unit_id === "228778" && m.joined && m.other === 108 && m.year === 2024), "Texas joined from the Big 12");
});

test("the SEC's lines recompute from the shards (today's members and members at the time)", () => {
  const sec = file.conferences.find((c) => c.code === SEC)!;
  const shards = SEC_IDS.map(shard);
  for (const meta of file.measures) {
    for (let y = meta.from; y <= meta.to; y++) {
      const i = y - meta.from;
      if (meta.cadence > 1 && y % meta.cadence !== 0) {
        assert.equal(sec.lines![meta.key].today[i], null);
        continue;
      }
      const vals = shards
        .map((h) => val(h, meta.key, y))
        .filter((v): v is number => v !== null)
        .map((v) => (meta.dollarsOf !== undefined ? (v * cpiAt(meta.dollarsOf)) / cpiAt(y) : v));
      const expected = vals.length >= SEC_IDS.length * 0.8 ? median(vals) : null;
      const got = sec.lines![meta.key].today[i];
      if (expected === null) assert.equal(got, null, `${meta.key} ${y}`);
      else assert.ok(Math.abs(got! - expected) <= (meta.key === "acceptance_rate" || meta.key === "out_of_state_share" ? 1e-4 : 0.5), `${meta.key} ${y}: ${got} vs ${expected}`);
    }
  }
  // Members at the time, fall of the newest year before Oklahoma and Texas joined: the 14 then-members only.
  const apps = file.measures.find((m) => m.key === "applicants")!;
  const y = 2023;
  const then = SEC_IDS.filter((id) => val(shard(id), "conference", y) === SEC);
  assert.equal(then.length, 14);
  const expected = median(then.map((id) => val(shard(id), "applicants", y)).filter((v): v is number => v !== null));
  assert.equal(sec.lines!.applicants.atTheTime[y - apps.from], Math.round(expected));
});

test("the SEC's ten-year applications change is the median member's own change", () => {
  const sec = file.conferences.find((c) => c.code === SEC)!;
  const apps = file.measures.find((m) => m.key === "applicants")!;
  assert.equal(apps.to, hmeta.latest.fall);
  const changes = SEC_IDS.map(shard).flatMap((h) => {
    const a = val(h, "applicants", apps.from);
    const b = val(h, "applicants", apps.to);
    return a && b !== null ? [b / a - 1] : [];
  });
  assert.ok(Math.abs(sec.change!.applicants! - median(changes)) < 1e-4);
  const t = sec.totals!.applicants!;
  const sum = (y: number) => SEC_IDS.reduce((s, id) => s + (val(shard(id), "applicants", y) ?? 0), 0);
  assert.equal(t.n, 16);
  assert.deepEqual([t.then, t.now], [sum(apps.from), sum(apps.to)]);
});

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
  assert.ok(file.conferences.filter((c) => !c.tooFew).length >= 100, "about 107 conferences have 8+ members");
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
  const pioneer = file.conferences.find((c) => c.code === 129);
  assert.ok(pioneer?.footballOnly && pioneer.members.length === 0 && (pioneer.footballMembers?.length ?? 0) > 0);
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
