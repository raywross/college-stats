/**
 * The review queue's clusters (lib/steward/cluster.ts; specs/product/data-steward.md "What a run does", "Tests"), on
 * the real sample of open items in tests/fixtures/steward/review-queue-sample.json: the top clusters are the same under
 * any item order and when every number in every detail changes; `previous-cohort-disagrees` and `aid-year` cluster by
 * the check alone while `edition-mismatch` clusters by its masked detail; a key never merges two checks. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewKey, type ReviewItem } from "../lib/reported.ts";
import {
  CLUSTER_DOCUMENTS,
  CLUSTER_EXAMPLES,
  CLUSTER_KEY_MAX,
  FREE_DETAIL_LIMIT,
  checkOfKey,
  clusterItems,
  clusterKey,
  clusterQueue,
  freeDetailChecks,
  maskDetail,
} from "../lib/steward/cluster.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "steward");
const QUEUE = JSON.parse(readFileSync(join(FIXTURES, "review-queue-sample.json"), "utf8")) as Record<string, ReviewItem>;
const ITEMS = Object.values(QUEUE);

/** A seeded shuffle (mulberry32), so a failure reproduces. */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const TOKEN = /\b[A-J]\.(?:\d{3,4}|\d[A-Z](?:\d{2})?)\b|\b(?:19|20)\d{2}\s*[-–—/]\s*(?:\d{4}|\d{2})\b|\d+(?:[.,]\d+)*/g;

/** Every number in a detail changed: codes kept, editions and years moved a year, other numbers moved far (never a year). */
function renumber(detail: string): string {
  return detail.replace(TOKEN, (tok) => {
    if (/^[A-J]\./.test(tok)) return tok;
    const edition = /^((?:19|20)\d{2})(\s*[-–—/]\s*)(\d{4}|\d{2})$/.exec(tok);
    if (edition) {
      const start = Number(edition[1]) + 1;
      return `${start}${edition[2]}${edition[3].length === 4 ? start + 1 : String((start + 1) % 100).padStart(2, "0")}`;
    }
    if (/^(?:19|20)\d{2}$/.test(tok)) return String(Number(tok) + 1);
    const n = Number(tok.replace(/,/g, ""));
    return (n + 100_000).toLocaleString("en-US", { maximumFractionDigits: 3 });
  });
}

test("maskDetail: codes, editions, years and numbers are masked and whitespace collapsed", () => {
  assert.equal(maskDetail("B5 loan_no_pell final cohort 1,436 vs IPEDS GR 774, both the fall 2018 class (more than 2% apart)"), "B# loan_no_pell final cohort # vs IPEDS GR #, both the fall Y class (more than #% apart)");
  assert.equal(maskDetail("H.101 is blank, which names no aid year"), "CODE is blank, which names no aid year");
  assert.equal(maskDetail("filed as 2025-26   until an item's text (B22, H4, I-2) confirms it"), "filed as Y until an item's text (B#, H#, I-#) confirms it");
  assert.equal(maskDetail("Common Data Set 2024-2025 vs 2025–26 and H.2A01, C.8D"), "Common Data Set Y vs Y and CODE, CODE");
  assert.equal(maskDetail("six-year rate 65.7534% vs 64.61%"), "six-year rate #% vs #%");
  assert.equal(maskDetail(renumber("parts sum to 1,993, the total says 2,014 (allowed ±1) in 2024-25")), maskDetail("parts sum to 1,993, the total says 2,014 (allowed ±1) in 2024-25"));
});

test("the top clusters are stable under re-ordering the items", () => {
  const base = clusterQueue(ITEMS);
  assert.ok(base.length > 14, "the sample makes more clusters than checks");
  for (const seed of [1, 7, 42, 2026]) assert.deepEqual(clusterQueue(shuffled(ITEMS, seed)), base, `seed ${seed}`);
  // Sorted largest first: items, then colleges.
  for (let i = 1; i < base.length; i++) assert.ok(base[i - 1].items > base[i].items || (base[i - 1].items === base[i].items && base[i - 1].colleges >= base[i].colleges));
});

test("the clusters are the same when every number in every detail changes", () => {
  const moved = ITEMS.map((i) => ({ ...i, failures: i.failures.map((f) => ({ ...f, detail: renumber(f.detail) })) }));
  assert.notDeepEqual(moved.map((i) => i.failures[0].detail), ITEMS.map((i) => i.failures[0].detail), "the details did change");
  assert.deepEqual(clusterQueue(moved), clusterQueue(ITEMS));
});

test("previous-cohort-disagrees and aid-year cluster by the check alone; edition-mismatch by its masked detail; free details cluster alone", () => {
  const clusters = clusterQueue(ITEMS);
  for (const check of ["previous-cohort-disagrees", "aid-year"]) {
    const mine = clusters.filter((c) => c.check === check);
    assert.equal(mine.length, 1, check);
    assert.equal(mine[0].detail, "");
    assert.equal(mine[0].key, `${check}|`);
    assert.equal(mine[0].items, ITEMS.filter((i) => i.failures.some((f) => f.check === check)).length);
  }
  const edition = clusters.filter((c) => c.check === "edition-mismatch");
  assert.equal(edition.length, 1);
  assert.equal(edition[0].detail, "the document states no edition; filed as Y until an item's text (B#, H#, I-#) confirms it");
  // number-on-line quotes each cited line: more than FREE_DETAIL_LIMIT distinct masked details, so one cluster.
  const distinct = new Set(ITEMS.flatMap((i) => i.failures.filter((f) => f.check === "number-on-line").map((f) => maskDetail(f.detail))));
  assert.ok(distinct.size > FREE_DETAIL_LIMIT);
  assert.ok(freeDetailChecks(ITEMS).has("number-on-line"));
  assert.deepEqual(clusters.filter((c) => c.check === "number-on-line").map((c) => c.detail), [""]);
  // parts-sum keeps its causes apart.
  assert.ok(clusters.filter((c) => c.check === "parts-sum").length > 3);
});

test("a key never merges two checks: every key is unique and starts with its own check", () => {
  const clusters = clusterQueue(ITEMS);
  assert.equal(new Set(clusters.map((c) => c.key)).size, clusters.length);
  for (const c of clusters) {
    assert.equal(checkOfKey(c.key), c.check);
    assert.ok(c.key.length <= CLUSTER_KEY_MAX);
  }
  // Two checks with the same detail stay apart.
  const twin = (check: string, unit: string): ReviewItem => ({ unit_id: unit, name: unit, urls: ["u"], entering_term: null, failures: [{ check: check as never, detail: "same words 12" }], queued: "2026-11-01", run: "r", code: "C.101", edition: "2025-26" });
  const keys = clusterQueue([twin("order", "1"), twin("parts-sum", "2")]).map((c) => c.key).sort();
  assert.deepEqual(keys, ["order|same words #", "parts-sum|same words #"]);
});

test("each cluster: items and colleges counted once, examples the first five keys in key order, up to twenty documents, published colleges", () => {
  const clusters = clusterQueue(ITEMS, { publishedBy: (i) => i.code?.startsWith("C.") ?? false });
  for (const c of clusters) {
    const members = clusterItems(ITEMS, c.key);
    assert.equal(members.length, c.items, c.key);
    assert.equal(new Set(members.map((i) => i.unit_id)).size, c.colleges);
    const keys = members.map(reviewKey).sort();
    assert.deepEqual(c.examples, keys.slice(0, CLUSTER_EXAMPLES));
    assert.ok(c.documents.length <= CLUSTER_DOCUMENTS && new Set(c.documents).size === c.documents.length);
    assert.deepEqual(c.documents, [...new Set(members.map((i) => i.sha256).filter((s): s is string => !!s))].slice(0, CLUSTER_DOCUMENTS));
    assert.equal(c.published, new Set(members.filter((i) => i.code?.startsWith("C.")).map((i) => i.unit_id)).size);
  }
  // An item with two failures is in both clusters; the sum of cluster sizes is the number of (item, cause) pairs.
  const multi = ITEMS.find((i) => new Set(i.failures.map((f) => f.check)).size > 1)!;
  assert.ok(multi, "the sample has an item failing two checks");
  const containing = clusters.filter((c) => clusterItems(ITEMS, c.key).some((i) => reviewKey(i) === reviewKey(multi)));
  assert.ok(containing.length >= 2);
});

test("resolved items aren't clustered", () => {
  const resolved = ITEMS.map((i, n) => (n % 2 ? { ...i, resolved: "rejected" as const } : i));
  const open = new Set(resolved.filter((i) => !i.resolved).map(reviewKey));
  const clusters = clusterQueue(resolved);
  assert.ok(clusters.length > 0);
  for (const c of clusters) for (const k of [...c.examples, ...clusterItems(resolved, c.key).map(reviewKey)]) assert.ok(open.has(k), k);
});

test("clusterKey: a long masked detail is cut to the store's 200 characters with a stable hash", () => {
  const long = "x ".repeat(150).trim();
  const a = clusterKey("order", long);
  assert.equal(a.length, CLUSTER_KEY_MAX);
  assert.equal(a, clusterKey("order", long));
  assert.notEqual(a, clusterKey("order", `${long} y`));
  assert.match(a, /~[0-9a-f]{8}$/);
  assert.equal(clusterKey("order", "short"), "order|short");
});
