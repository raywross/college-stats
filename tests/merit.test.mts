/**
 * Merit classes (specs/product/cost-by-income.md "Merit"; lib/merit.ts): from the college's Common Data Set, its
 * published policy, or the IPEDS proxy, in that order. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MERIT_PROXY_MIN, meritFor, meritProxy, offersMerit, proxyMisleads } from "../lib/merit.ts";
import type { AidPolicy } from "../lib/aid-policies.ts";
import type { H2Headline, School } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

const NO_H2: H2Headline = { a: null, c: null, d: null, h: null, i: null, j: null, k: null, m: null, n: null, o: null, p: null, q: null };

/** A college with only what each test gives it. */
function school(parts: { firstYears?: Partial<H2Headline>; cds?: { undergrads: number | null; merit_no_need: number | null; merit_avg: number | null }; aid?: Partial<NonNullable<School["aid"]>> }): School {
  return {
    unit_id: "999999",
    name: "Test College",
    ...(parts.firstYears ? { reported: { aid: { first_years: { ...NO_H2, ...parts.firstYears } } } } : {}),
    aid: {
      cohort: null,
      any_aid_pct: null,
      grant_pct: null,
      grant_avg: null,
      institutional_pct: null,
      institutional_avg: null,
      pell_pct: null,
      pell_avg: null,
      state_pct: null,
      loan_pct: null,
      loan_avg: null,
      by_income: null,
      ...(parts.cds
        ? { cds: { applied_need: null, has_need: null, need_fully_met: null, pct_need_met: null, avg_package: null, avg_need_grant: null, avg_need_loan: null, ...parts.cds } }
        : {}),
      ...parts.aid,
    },
  } as unknown as School;
}

const needOnly = { need_only: true } as AidPolicy;
/** 1,000 first-years; 600 got grants; federal-aid recipients account for `fed` of them and $9M of the $30M. */
const proxyAid = (fed: number) => ({
  cohort: 1_000,
  grant_count: 600,
  grant_total: 30_000_000,
  by_income: { counts: [100, 100, 100, 100, 100], avg_grant: [null, null, null, null, null], granted: [fed / 5, fed / 5, fed / 5, fed / 5, fed / 5], total_grants: [1.8e6, 1.8e6, 1.8e6, 1.8e6, 1.8e6] },
});

test("CDS H2A first-year column: n > 0 is merit (share n ÷ line a, average line o); n = 0 is need-only", () => {
  assert.deepEqual(meritFor(school({ firstYears: { a: 1_600, n: 160, o: 22_000 } }), null), { cls: "merit_reported", share: 0.1, avg: 22_000, source: "cds" });
  assert.deepEqual(meritFor(school({ firstYears: { a: 1_600, n: 0, o: null } }), null), { cls: "need_only", share: 0, avg: null, source: "cds" });
  assert.deepEqual(meritFor(school({ firstYears: { a: null, n: 54, o: 23_168 } }), null), { cls: "merit_reported", share: null, avg: 23_168, source: "cds" }, "no line a: no share");
});

test("the hand-imported CDS (aid.cds, full-time column) when the college's own record has no H2A", () => {
  assert.deepEqual(meritFor(school({ firstYears: { a: 1_000, n: null }, cds: { undergrads: 6_000, merit_no_need: 600, merit_avg: 15_000 } }), null), {
    cls: "merit_reported",
    share: 0.1,
    avg: 15_000,
    source: "cds",
  });
  assert.equal(meritFor(school({ cds: { undergrads: 6_000, merit_no_need: 0, merit_avg: null } }), null).cls, "need_only");
});

test("CDS outranks the policy, the policy outranks the proxy", () => {
  const reported = school({ firstYears: { a: 1_000, n: 50, o: 10_000 }, aid: proxyAid(100) });
  assert.equal(meritFor(reported, needOnly).cls, "merit_reported");
  const proxied = school({ aid: proxyAid(100) });
  assert.deepEqual(meritFor(proxied, needOnly), { cls: "need_only", share: null, avg: null, source: "policy" });
  assert.equal(meritFor(proxied, { need_only: false } as AidPolicy).cls, "merit_proxy", "only need_only: true decides");
});

test("IPEDS proxy: grants without federal aid ÷ first-years; 2% or more is merit_proxy with its average, under 2% need-only", () => {
  const m = meritFor(school({ aid: proxyAid(100) }), null);
  assert.equal(m.cls, "merit_proxy");
  assert.equal(m.source, "ipeds");
  assert.equal(m.share, 0.5, "(600 − 100) ÷ 1,000");
  assert.equal(m.avg, (30_000_000 - 9_000_000) / 500);
  const few = meritFor(school({ aid: proxyAid(590) }), null);
  assert.equal(few.cls, "need_only", "10 of 1,000 is under 2%");
  assert.equal(few.share, 0.01);
  assert.equal(MERIT_PROXY_MIN, 0.02);
  assert.equal(meritFor(school({ aid: proxyAid(580) }), null).cls, "merit_proxy", "exactly 2%");
});

test("unknown without any source; an impossible proxy (more federal grant recipients than grant recipients) is unknown", () => {
  assert.deepEqual(meritFor(school({}), null), { cls: "unknown", share: null, avg: null, source: null });
  assert.equal(meritProxy(school({ aid: { ...proxyAid(700) } })), null);
  assert.equal(meritFor(school({ aid: { ...proxyAid(100), cohort: 0 } }), null).cls, "unknown");
});

test("offersMerit is reported or proxy", () => {
  assert.equal(offersMerit({ cls: "merit_reported", share: 0.1, avg: 1, source: "cds" }), true);
  assert.equal(offersMerit({ cls: "merit_proxy", share: 0.1, avg: 1, source: "ipeds" }), true);
  assert.equal(offersMerit({ cls: "need_only", share: 0, avg: null, source: "cds" }), false);
  assert.equal(offersMerit({ cls: "unknown", share: null, avg: null, source: null }), false);
});

test("real colleges: Vanderbilt and Georgia report merit in their CDS; the proxy agrees with AidBreakdown's 'Grants, no federal aid' row", () => {
  const vandy = schools.find((s) => s.unit_id === "221999")!;
  const v = meritFor(vandy, null);
  assert.equal(v.cls, "merit_reported");
  assert.equal(v.share, vandy.reported!.aid!.first_years!.n! / vandy.reported!.aid!.first_years!.a!);
  assert.equal(meritFor(schools.find((s) => s.unit_id === "139959")!, null).cls, "merit_reported");
  const usc = schools.find((s) => s.unit_id === "123961")!;
  const aid = usc.aid!;
  const fedGranted = aid.by_income!.granted!.reduce<number>((a, b) => a + (b ?? 0), 0);
  assert.equal(meritProxy(usc)!.share, (aid.grant_count! - fedGranted) / aid.cohort!);
});

test("the proxy isn't used where it misleads: full-need colleges (unless need_only is false) and their own need formula", () => {
  const proxied = school({ aid: proxyAid(100) });
  const fullNeed = { meets_full_need: true, need_only: null } as AidPolicy;
  assert.deepEqual(meritFor(proxied, fullNeed), { cls: "unknown", share: null, avg: null, source: null });
  assert.equal(proxyMisleads(proxied, fullNeed), true);
  assert.equal(meritFor(proxied, { meets_full_need: true, need_only: false } as AidPolicy).cls, "merit_proxy", "says it gives merit: the proxy stands");
  assert.equal(meritFor(proxied, { meets_full_need: true, need_only: true } as AidPolicy).cls, "need_only", "says need-only: need-only");
  assert.equal(meritFor(proxied, { meets_full_need: false, need_only: null } as AidPolicy).cls, "merit_proxy");
  // Its own formula: the CSS Profile required (derived.aid_methodology institutional, inferred), or stated.
  const css = { ...proxied, reported: { aid: { methodology: null, forms: { fafsa: true, css_profile: true, own_form: false } } } } as unknown as School;
  assert.equal(meritFor(css, null).cls, "unknown");
  const stated = { ...proxied, reported: { aid: { methodology: "institutional", forms: null } } } as unknown as School;
  assert.equal(meritFor(stated, null).cls, "unknown");
  const federal = { ...proxied, reported: { aid: { methodology: "federal", forms: null } } } as unknown as School;
  assert.equal(meritFor(federal, null).cls, "merit_proxy");
  // The college's own CDS still wins over all of this.
  assert.equal(meritFor(school({ firstYears: { a: 1_000, n: 50, o: 9_000 }, aid: proxyAid(100) }), fullNeed).cls, "merit_reported");
});

test("real full-need colleges never show merit_proxy: Princeton, Stanford, Yale, Duke (with their curated policies)", () => {
  for (const id of ["186131", "243744", "130794", "198419"]) {
    const s = schools.find((x) => x.unit_id === id)!;
    assert.notEqual(meritFor(s).cls, "merit_proxy", s.name);
    // Without the policy the proxy would say merit, unless the college's own CDS already marks its methodology as
    // institutional (Yale's record has had one since the 2026-10-10 college-reported run), which also skips it.
    const bare = meritFor(s, null).cls;
    assert.ok(bare === "merit_proxy" || (bare === "unknown" && proxyMisleads(s, null)), `${s.name}: ${bare}`);
  }
});
