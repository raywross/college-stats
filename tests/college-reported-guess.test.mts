/**
 * Guessing next year's Common Data Set URL (scripts/lib/college-reported/guess.mts), against the URL shapes the pilot
 * met (specs/college-reported-round-2.md, decision 2). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { guessNextEditionUrls } from "../scripts/lib/college-reported/guess.mts";

test("the edition in the file name moves ahead one and two years, newest first; folders are left alone", () => {
  // Vanderbilt and Cornell: an upload-date folder that must not change.
  assert.deepEqual(guessNextEditionUrls("https://cdn.vanderbilt.edu/vu-wpfsx/wp-content/uploads/sites/70/2025/11/CDS_2024-2025.xlsx", 2024), [
    "https://cdn.vanderbilt.edu/vu-wpfsx/wp-content/uploads/sites/70/2025/11/CDS_2026-2027.xlsx",
    "https://cdn.vanderbilt.edu/vu-wpfsx/wp-content/uploads/sites/70/2025/11/CDS_2025-2026.xlsx",
  ]);
  assert.deepEqual(guessNextEditionUrls("https://irp.cornell.edu/wp-content/uploads/2026/09/CDS-Cornell-2025-2026-v2.xlsx", 2025), [
    "https://irp.cornell.edu/wp-content/uploads/2026/09/CDS-Cornell-2027-2028-v2.xlsx",
    "https://irp.cornell.edu/wp-content/uploads/2026/09/CDS-Cornell-2026-2027-v2.xlsx",
  ]);
  // Maryland and William & Mary.
  assert.deepEqual(guessNextEditionUrls("https://www.irpa.umd.edu/InstitutionalData/CommonDataSet/CDS_2024-2025.xlsx", 2024), [
    "https://www.irpa.umd.edu/InstitutionalData/CommonDataSet/CDS_2026-2027.xlsx",
    "https://www.irpa.umd.edu/InstitutionalData/CommonDataSet/CDS_2025-2026.xlsx",
  ]);
  assert.deepEqual(guessNextEditionUrls("https://www.wm.edu/offices/ir/university_data/cds/wm-2025-2026-cds1.xlsx", 2024), [
    "https://www.wm.edu/offices/ir/university_data/cds/wm-2027-2028-cds1.xlsx",
    "https://www.wm.edu/offices/ir/university_data/cds/wm-2026-2027-cds1.xlsx",
  ]);
});

test("every edition style colleges use", () => {
  const next = (url: string) => guessNextEditionUrls(url, 2024).at(-1);
  assert.equal(next("https://x.edu/ir/CDS_2024-25.pdf"), "https://x.edu/ir/CDS_2025-26.pdf");
  assert.equal(next("https://x.edu/ir/cds_2024_25.pdf"), "https://x.edu/ir/cds_2025_26.pdf");
  assert.equal(next("https://x.edu/ir/cds_2024_2025.pdf"), "https://x.edu/ir/cds_2025_2026.pdf");
  assert.equal(next("https://x.edu/ir/CDS2425.pdf"), "https://x.edu/ir/CDS2526.pdf");
  assert.equal(next("https://x.edu/ir/CDS2024.pdf"), "https://x.edu/ir/CDS2025.pdf");
  assert.equal(next("https://x.edu/ir/Common%20Data%20Set%202024-2025.pdf"), "https://x.edu/ir/Common%20Data%20Set%202025-2026.pdf");
  // The query string survives; the two-digit form wraps at a century ("99-00").
  assert.equal(next("https://x.edu/ir/CDS_2024-25.xlsx?download=1"), "https://x.edu/ir/CDS_2025-26.xlsx?download=1");
  assert.equal(guessNextEditionUrls("https://x.edu/ir/CDS_2098-99.pdf", 2024).at(-1), "https://x.edu/ir/CDS_2099-00.pdf");
});

test("no guess when the file name names no edition, or only editions no newer than the federal year", () => {
  assert.deepEqual(guessNextEditionUrls("https://docs.google.com/spreadsheets/d/11BnFbit7JcrmFMi9iV_TMkzhUyCQ_dQHS0V8weuOHPM/export?format=xlsx", 2024), []);
  assert.deepEqual(guessNextEditionUrls("https://uofi.box.com/shared/static/1m3p4sedkotywoec55zbnodc4oci5ctf.xlsx", 2024), []);
  assert.deepEqual(guessNextEditionUrls("not a url", 2024), []);
  // The folder's year is not the edition: nothing in "cds.pdf" to change.
  assert.deepEqual(guessNextEditionUrls("https://x.edu/2025-2026/cds.pdf", 2024), []);
  // Federal data already covers fall 2025: only the 2026-27 edition can be newer.
  assert.deepEqual(guessNextEditionUrls("https://x.edu/CDS_2024-2025.pdf", 2025), ["https://x.edu/CDS_2026-2027.pdf"]);
});
