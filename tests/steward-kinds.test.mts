/**
 * The four kinds of issue by rule (lib/steward/kinds.ts; specs/product/data-steward.md "Four kinds of issue"): each
 * case planted in a small queue, the order of the rules (acquisition before policy before systemic), and every cluster
 * of the real queue sample getting exactly one kind. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckId, ReviewItem } from "../lib/reported.ts";
import { clusterQueue } from "../lib/steward/cluster.ts";
import { ACQUISITION_CHECKS, POLICY_CHECKS, SYSTEMIC_COLLEGES, kindContext, kindOf, kindsOf } from "../lib/steward/kinds.ts";
import { ISSUE_KINDS, type IssueKind } from "../lib/steward/types.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "steward");
const ITEMS = Object.values(JSON.parse(readFileSync(join(FIXTURES, "review-queue-sample.json"), "utf8")) as Record<string, ReviewItem>);

let seq = 0;
/** One open item at a college, with one failure; a document named by `sha` unless it is null. */
function item(unit: string, check: string, detail: string, sha: string | null = `sha-${unit}`): ReviewItem {
  seq++;
  return {
    unit_id: unit,
    name: `College ${unit}`,
    urls: [`https://example.edu/${unit}/cds.pdf`],
    entering_term: "Fall 2025",
    failures: [{ check: check as CheckId, detail }],
    queued: "2026-11-01",
    run: "r1",
    code: `C.${String(100 + (seq % 900)).padStart(3, "0")}`,
    edition: "2025-26",
    ...(sha ? { sha256: sha } : {}),
    value: seq,
  };
}

/** The kind of the cluster with this key, over these items. */
function kind(items: ReviewItem[], key: string, fetched?: (sha: string) => boolean): IssueKind {
  const clusters = clusterQueue(items);
  const c = clusters.find((x) => x.key === key);
  assert.ok(c, `no cluster ${key}: ${clusters.map((x) => x.key).join(", ")}`);
  return kindOf(c, kindContext(items, { fetched }));
}

const colleges = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(100000 + from + i));

test("acquisition: unreachable and not-a-url, whatever else holds", () => {
  for (const check of ACQUISITION_CHECKS) {
    const items = colleges(12).map((u) => item(u, check, "HTTP 404 at the link"));
    assert.equal(kind(items, `${check}|HTTP # at the link`), "acquisition", check);
  }
});

test("acquisition: line-in-document with no document; with a document we hold it is a value issue", () => {
  assert.equal(kind([item("1", "line-in-document", "no line cited", null)], "line-in-document|no line cited"), "acquisition");
  assert.equal(kind([item("1", "line-in-document", "no line cited", "abc")], "line-in-document|no line cited", (s) => s === "abc"), "value");
  assert.equal(kind([item("1", "line-in-document", "no line cited", "abc")], "line-in-document|no line cited", () => false), "acquisition", "a document never fetched");
});

test("acquisition: every document the items name is unfetched; one fetched document makes it a value issue", () => {
  const items = [item("1", "order", "a ≤ b fails 3", "s1"), item("2", "order", "a ≤ b fails 4", "s2")];
  assert.equal(kind(items, "order|a ≤ b fails #", () => false), "acquisition");
  assert.equal(kind(items, "order|a ≤ b fails #", (s) => s === "s2"), "value");
  assert.equal(kind(items, "order|a ≤ b fails #"), "value", "without a manifest, every document counts as fetched");
  // Items with no document at all (round-1/2 C1 entries) aren't acquisition by that rule.
  assert.equal(kind([item("1", "order", "a ≤ b fails 3", null)], "order|a ≤ b fails #", () => false), "value");
});

test("policy: the owner's checks, even when one detail is most of the check at many colleges", () => {
  for (const check of POLICY_CHECKS) {
    const items = colleges(15).map((u) => item(u, check, "differs from federal by 20 points"));
    const key = check === "previous-cohort-disagrees" ? `${check}|` : `${check}|differs from federal by # points`;
    assert.equal(kind(items, key), "policy", check);
  }
});

test("acquisition comes before policy", () => {
  const items = [item("1", "plausible-change", "applicants ×3 vs federal", "s1")];
  assert.equal(kind(items, "plausible-change|applicants ×# vs federal", () => false), "acquisition");
});

test("systemic: one masked detail with more than 60% of the check's items across more than 10 colleges", () => {
  const big = colleges(SYSTEMIC_COLLEGES + 1).map((u, i) => item(u, "sums-to-100", `SAT bands sum to ${90 + i}%`));
  const rest = colleges(5, 50).map((u) => item(u, "sums-to-100", "ACT bands sum to 97%"));
  const items = [...big, ...rest];
  assert.equal(kind(items, "sums-to-100|SAT bands sum to #%"), "systemic");
  assert.equal(kind(items, "sums-to-100|ACT bands sum to #%"), "value");
  // At exactly ten colleges it is a value issue.
  const ten = colleges(SYSTEMIC_COLLEGES).map((u) => item(u, "sums-to-100", "SAT bands sum to 91%"));
  assert.equal(kind(ten, "sums-to-100|SAT bands sum to #%"), "value");
  // At 60% or less of the check's items it is a value issue.
  const half = [...colleges(12).map((u) => item(u, "order", "x 1")), ...colleges(12, 60).map((u) => item(u, "order", "y 1"))];
  assert.equal(kind(half, "order|x #"), "value");
});

test("systemic for a check clustered alone: judged by its most common detail", () => {
  const items = colleges(12).map((u) => item(u, "aid-year", "H.101 is blank, which names no aid year"));
  assert.equal(kind(items, "aid-year|"), "systemic");
  const varied = colleges(12).map((u, i) => item(u, "aid-year", `H.101 says ${"abcdefghijkl"[i]}, which names no aid year`));
  assert.equal(kind(varied, "aid-year|"), "value");
});

test("value: everything else", () => {
  assert.equal(kind([item("1", "parts-sum", "parts sum to 9, the total says 10")], "parts-sum|parts sum to #, the total says #"), "value");
});

test("every cluster of the real queue sample gets exactly one of the four kinds", () => {
  const clusters = clusterQueue(ITEMS);
  const kinds = kindsOf(clusters, ITEMS);
  assert.equal(kinds.size, clusters.length);
  for (const c of clusters) assert.ok(ISSUE_KINDS.includes(kinds.get(c.key)!), c.key);
  assert.equal(kinds.get("previous-cohort-disagrees|"), "policy");
  // The sample's 40 grid-column items sit at one college: not systemic at that size.
  const grid = clusters.find((c) => c.check === "grid-column")!;
  assert.equal(kinds.get(grid.key), grid.colleges > SYSTEMIC_COLLEGES ? "systemic" : "value");
});
