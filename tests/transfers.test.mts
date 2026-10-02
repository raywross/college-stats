/**
 * Transfers in (specs/data-expansion/transfers.md): the EF{Y}A reader, the level-code checks that stop a refresh when
 * NCES renumbers or redefines a level, and the stored values and history. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { EFA_COLUMNS, EFA_FIRST_YEAR, checkTransferLevels, transferInFrom, transferShare } from "../lib/transfers.ts";
import { ERAS, requiredColumns } from "../scripts/history/registry.mts";
import { lastPointMismatches } from "../scripts/history/build.mts";
import { parseFilters } from "../lib/params.ts";
import type { SchoolHistory } from "../lib/history.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

/** A pivoted EF{Y}A row: first-time (4) and transfer-ins (19 all, 39 full-time, 59 part-time). Omitted = no row. */
const efa = (levels: Record<number, string>) => Object.fromEntries(Object.entries(levels).map(([k, v]) => [`EFTOTLT_${k}`, v]));

test("the reader counts transfer-ins and their share of new undergraduates", () => {
  const t = transferInFrom(efa({ 4: "1630", 19: "359", 39: "359" }))!;
  assert.deepEqual(t, { count: 359, full_time: 359, part_time: 0, share_of_new: 0.1805 });
});

test("a level NCES left out is 0 (it omits zero rows); a college missing from the file is null, never 0", () => {
  assert.deepEqual(transferInFrom(efa({ 4: "500" })), { count: 0, full_time: 0, part_time: 0, share_of_new: 0 });
  assert.equal(transferInFrom(undefined), null);
  assert.equal(transferInFrom(efa({ 4: "500", 19: "" })), null, "a blank count is unreadable, not 0");
});

test("no new students at all gives no share, not 0% or a divide-by-zero", () => {
  assert.equal(transferInFrom(efa({ 2: "40" }))!.share_of_new, null);
});

test("the level checks pass real-looking data and stop on renumbered or redefined levels", () => {
  const ids = Array.from({ length: 200 }, (_, i) => String(i));
  const good = new Map(ids.map((id) => [id, efa({ 4: "100", 19: "30", 39: "20", 59: "10" })]));
  const drv = new Map(ids.map((id) => [id, { EFUGTRN: "30", EFUG1ST: "100" }]));
  assert.deepEqual(checkTransferLevels(good, drv, ids).problems, []);
  assert.deepEqual(checkTransferLevels(good, null, ids).problems, [], "DRVEF not out yet: the add-up check still runs");
  // Level 19 no longer equals 39 + 59 (e.g. NCES renumbered part-time transfer-ins).
  const badSum = new Map(ids.map((id) => [id, efa({ 4: "100", 19: "30", 39: "20", 59: "5" })]));
  assert.equal(checkTransferLevels(badSum, null, ids).problems.length, 1);
  // Level 19 adds up but no longer matches NCES's own derived count (e.g. 19 now means something else).
  const badDerived = new Map(ids.map((id) => [id, { EFUGTRN: "45", EFUG1ST: "100" }]));
  assert.equal(checkTransferLevels(good, badDerived, ids).problems.length, 1);
  // A few colleges off (under 1%) is reporting noise, not a changed file.
  const fewOff = new Map(drv);
  fewOff.set("0", { EFUGTRN: "31", EFUG1ST: "100" });
  assert.deepEqual(checkTransferLevels(good, fewOff, ids).problems, []);
});

test("a renamed column stops sync-data and sync-history; history starts with the first year that has transfer-ins", () => {
  const era = ERAS.find((e) => e.family === "ef-a")!;
  assert.equal(era.years[0], EFA_FIRST_YEAR);
  for (const c of EFA_COLUMNS) assert.ok(requiredColumns(era, era.files(EFA_FIRST_YEAR)[0]).includes(c), c);
});

test("stored values: nearly every college, counts add up, shares are fractions, and the vintage is a fall", () => {
  const withTransfers = schools.filter((s) => s.demographics.transfer_in != null);
  assert.ok(withTransfers.length > 0.95 * schools.length, `${withTransfers.length} colleges`);
  for (const s of withTransfers) {
    const t = s.demographics.transfer_in!;
    assert.equal(t.count, t.full_time + t.part_time, s.name);
    if (t.share_of_new !== null) assert.ok(t.share_of_new >= 0 && t.share_of_new <= 1, s.name);
  }
  assert.match(meta.vintages["ipeds-ef-a"] ?? "", /^Fall \d{4}$/);
  // Vanderbilt, fall 2024 (EF2024A; DRVEF2024 EFUGTRN agrees): 359 transfer-ins, 1,630 first-time students.
  assert.deepEqual(byId("221999").demographics.transfer_in, { count: 359, full_time: 359, part_time: 0, share_of_new: 0.1805 });
  assert.equal(transferShare(byId("221999")), 0.1805);
});

test("Explore sorts by transfer share", () => {
  assert.equal(parseFilters({ sortBy: "transfer_share" }).sortBy, "transfer_share");
});

test("history: every fall from 2008, ending on the snapshot (rule 1)", () => {
  const h: SchoolHistory = JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", "221999.json"), "utf8"));
  const s = byId("221999");
  assert.equal(h.series.transfer_in_count!.start, EFA_FIRST_YEAR);
  assert.equal(h.series.transfer_in_count!.values[0], 172, "fall 2008, from EF2008A");
  assert.equal(h.series.transfer_in_count!.values.at(-1), s.demographics.transfer_in!.count);
  assert.equal(h.series.transfer_in_share!.values.at(-1), s.demographics.transfer_in!.share_of_new);
  const latest = { fall: 2024, academic: 2023 };
  const only = (list: string[]) => list.filter((m) => m.includes(" transfer_in_"));
  assert.deepEqual(only(lastPointMismatches([s], new Map([[s.unit_id, h]]), latest)), []);
  const broken = structuredClone(s);
  broken.demographics.transfer_in!.count = 1;
  assert.equal(only(lastPointMismatches([broken], new Map([[s.unit_id, h]]), latest)).length, 1, "a drifted snapshot is caught");
});
