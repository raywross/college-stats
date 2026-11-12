/**
 * The seven automated checks (specs/college-reported-data.md#automated-checks) and the conversion from a passing
 * extraction to a published entry. Pure module: no runtime imports besides lib/reported.ts and lib/fields.ts, so the
 * pipeline (scripts/sync-college-reported.mts, built separately) and the sync can both depend on it without pulling
 * in the rest of the app. Exports are named exactly as the pipeline imports them: `runChecks`, `toReportedEntry`,
 * `reportedToPatch`; `normalizeExtraction` reads an extraction stored before the fall-figures build, and
 * `entryFromPicks` assembles an entry figure by figure (lib/reported-combine.ts combineByTerm).
 */
import type { LineageRecord, ReportedAdmissions, ReportedData, ReportedSourceKind, School } from "./types";
import {
  fallYear,
  type CheckFailure,
  type CheckId,
  type Extraction,
  type QualifiedFigure,
  type ReportedEntry,
  type ReportedValuePath,
  type StoredExtraction,
} from "./reported.ts";
import type { FieldPath } from "./fields.ts";

function fail(check: CheckId, detail: string): CheckFailure {
  return { check, detail };
}

/**
 * An extraction with every fall-figures key (specs/college-reported-fall-figures.md): one stored before 2026-11-11 has
 * no `qualifiers` (all its figures are exact), no `enrollment_target` and no `deposits` (null). Every reader of a
 * stored extraction goes through this; `runChecks`, `toReportedEntry` and `combineByTerm` call it themselves.
 */
export function normalizeExtraction(e: Extraction | StoredExtraction): Extraction {
  return { ...e, qualifiers: e.qualifiers ?? {}, enrollment_target: e.enrollment_target ?? null, deposits: e.deposits ?? null };
}

/** The college printed this figure as a rounded one ("more than 82,000"). */
export function isApprox(e: Pick<Extraction, "qualifiers"> | StoredExtraction, k: QualifiedFigure): boolean {
  return e.qualifiers?.[k] === "approx";
}

/** The rate a value implies: as stated, or admitted ÷ applicants when both counts are known. */
function effectiveRate(x: Pick<Extraction, "acceptance_rate" | "admitted" | "applicants">): number | null {
  if (x.acceptance_rate !== null) return x.acceptance_rate;
  if (x.admitted !== null && x.applicants !== null && x.applicants > 0) return x.admitted / x.applicants;
  return null;
}

/** The rate a value implies from exact figures only: a stated exact rate, or admitted ÷ applicants from two exact counts. */
function exactRate(x: Extraction): number | null {
  if (x.acceptance_rate !== null) return isApprox(x, "acceptance_rate") ? null : x.acceptance_rate;
  if (isApprox(x, "applicants") || isApprox(x, "admitted")) return null;
  return effectiveRate(x);
}

/** "46,618" or "46618" → true for value 46618; tolerant of thousands separators. */
function countAppearsInQuote(value: number, quote: string): boolean {
  const normalized = quote.replace(/,/g, "");
  return normalized.includes(String(value));
}

/** "4.0%" or "4 percent" → true for the fraction 0.04 (tolerant of rounding to the quoted precision). */
function rateAppearsInQuote(value: number, quote: string): boolean {
  const pct = value * 100;
  const matches = quote.match(/(\d+(?:\.\d+)?)\s*(%|percent)/gi);
  if (!matches) return false;
  return matches.some((m) => {
    const num = parseFloat(m);
    return Number.isFinite(num) && Math.abs(num - pct) < 0.05;
  });
}

/**
 * All seven checks, numbered as in the spec. `others` are extractions of the same college for the same run (check 7).
 * Fall figures (specs/college-reported-fall-figures.md Decision 3): check 1 fails a multi-campus or all-undergraduate
 * cohort; check 2 holds an approximate figure's printed number to its quote ("82,000" in "more than 82,000") and covers
 * the class goal and deposits; check 4 is skipped when a figure it compares is approximate; check 7 compares exact
 * figures only. Accepts an extraction stored before those keys existed (`normalizeExtraction`).
 */
export function runChecks(input: Extraction | StoredExtraction, school: School, othersInput?: (Extraction | StoredExtraction)[]): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const x = normalizeExtraction(input);
  const others = othersInput?.map(normalizeExtraction);

  // 1. Cohort is first-year and scope is all rounds (not early decision only). A system's or several campuses' total,
  // or new students of every level, is never a first-year figure.
  if (x.cohort === "multi-campus" || x.cohort === "all-undergraduates") {
    failures.push(fail("cohort-and-scope", `cohort="${x.cohort}": figures for ${x.cohort === "multi-campus" ? "more than one campus or a whole system" : "students of every level"} are never first-year figures`));
  } else if (x.cohort !== "first-year" || x.scope !== "all-rounds") {
    failures.push(fail("cohort-and-scope", `cohort="${x.cohort}", scope="${x.scope}" (need first-year, all-rounds)`));
  }

  // 2. Every published number has a quote, and the number appears in the quote: an approximate one too (its printed
  // number, as the model reports it), and the announced class goal and deposits.
  const numberFields: { key: QualifiedFigure | "enrollment_target" | "deposits"; isRate: boolean }[] = [
    { key: "applicants", isRate: false },
    { key: "admitted", isRate: false },
    { key: "enrolled", isRate: false },
    { key: "acceptance_rate", isRate: true },
    { key: "enrollment_target", isRate: false },
    { key: "deposits", isRate: false },
  ];
  for (const { key, isRate } of numberFields) {
    const value = x[key];
    if (value === null) continue;
    const quote = x.quotes[key];
    if (!quote) {
      failures.push(fail("quote-present", `${key}=${value} has no quote`));
      continue;
    }
    const present = isRate ? rateAppearsInQuote(value, quote) : countAppearsInQuote(value, quote);
    if (!present) failures.push(fail("quote-present", `${key}=${value} doesn't appear in its quote "${quote}"`));
  }

  // 3. admitted ≤ applicants, enrolled ≤ admitted.
  if (x.admitted !== null && x.applicants !== null && x.admitted > x.applicants) {
    failures.push(fail("funnel-order", `admitted ${x.admitted} > applicants ${x.applicants}`));
  }
  if (x.enrolled !== null && x.admitted !== null && x.enrolled > x.admitted) {
    failures.push(fail("funnel-order", `enrolled ${x.enrolled} > admitted ${x.admitted}`));
  }

  // 4. Stated rate matches admitted ÷ applicants, when both are given, within the precision the college printed:
  //    "42%" allows 0.5 pt (Clemson states 42% for 42.43%), "4.0%" allows 0.1 pt, "4.18%" 0.05 pt. Otherwise nothing
  //    to check (the rate is computed instead, in toReportedEntry). A rounded figure ("about 10%", "more than 82,000")
  //    can't be held to that precision, so the check is skipped when any of the three is approximate.
  const anyApprox = isApprox(x, "acceptance_rate") || isApprox(x, "applicants") || isApprox(x, "admitted");
  if (!anyApprox && x.acceptance_rate !== null && x.admitted !== null && x.applicants !== null && x.applicants > 0) {
    const computed = x.admitted / x.applicants;
    const diffPts = Math.abs(x.acceptance_rate - computed) * 100;
    const tolerance = rateTolerancePts(x.quotes.acceptance_rate);
    if (diffPts > tolerance) {
      failures.push(
        fail("rate-matches", `stated rate ${(x.acceptance_rate * 100).toFixed(2)}% vs admitted ÷ applicants ${(computed * 100).toFixed(2)}% (diff ${diffPts.toFixed(2)} pt, allowed ${tolerance} for a rate printed as "${quotedRate(x.quotes.acceptance_rate) ?? "?"}")`),
      );
    }
  }

  // 5. Entering term is newer than the college's federal admissions year. A null term fails.
  const year = fallYear(x.entering_term);
  if (year === null) {
    failures.push(fail("newer-than-federal", `entering_term "${x.entering_term}" isn't a recognizable "Fall YYYY"`));
  } else if (school.admissions.year !== null && year <= school.admissions.year) {
    failures.push(fail("newer-than-federal", `entering term ${year} isn't newer than the federal admissions year ${school.admissions.year}`));
  }

  // 6. Plausible change vs the latest federal year: applicants ×0.5–×2, admit rate ±15 pts (±50% relative under 10%).
  const federalApplicants = school.admissions.applicants;
  if (x.applicants !== null && federalApplicants !== null && federalApplicants > 0) {
    const ratio = x.applicants / federalApplicants;
    if (ratio < 0.5 || ratio > 2) {
      failures.push(fail("plausible-change", `applicants ${x.applicants} vs federal ${federalApplicants} (×${ratio.toFixed(2)}, need ×0.5–×2)`));
    }
  }
  const rate = effectiveRate(x);
  const federalRate = school.admissions.acceptance_rate;
  if (rate !== null && federalRate !== null) {
    const diffPts = Math.abs(rate - federalRate) * 100;
    const limit = federalRate < 0.1 ? federalRate * 0.5 * 100 : 15;
    if (diffPts > limit) {
      failures.push(
        fail("plausible-change", `acceptance rate ${(rate * 100).toFixed(2)}% vs federal ${(federalRate * 100).toFixed(2)}% (diff ${diffPts.toFixed(2)} pt, limit ${limit.toFixed(2)} pt)`),
      );
    }
  }

  // 7. Two sources for the same term, cohort, and scope agree on every number both have: counts within 1%, the rate
  // within the tolerance of how it was printed (a profile's "5%" is 4.5–5.5%, as in check 4). A regular-decision
  // summary (scope regular-only) or a source whose scope is unknown is never held against a whole-cycle Common Data
  // Set: the numbers describe different pools, so a gap between them is not a disagreement (Vanderbilt, 2026-11-10).
  // Only exact figures are compared: "more than 82,000" doesn't disagree with 82,118 (fall figures, Decision 3).
  for (const other of others ?? []) {
    if (other.entering_term !== x.entering_term) continue;
    if (other.cohort !== x.cohort || other.scope !== x.scope) continue;
    for (const key of ["applicants", "admitted", "enrolled"] as const) {
      const a = x[key];
      const b = other[key];
      if (a === null || b === null || isApprox(x, key) || isApprox(other, key)) continue;
      const denom = Math.max(Math.abs(a), Math.abs(b), 1);
      const rel = Math.abs(a - b) / denom;
      if (rel > 0.01) failures.push(fail("sources-agree", `${key} ${a} vs other source's ${b} (${(rel * 100).toFixed(1)}% apart)`));
    }
    const ra = exactRate(x);
    const rb = exactRate(other);
    if (ra !== null && rb !== null) {
      const diffPts = Math.abs(ra - rb) * 100;
      const tolerance = Math.max(rateTolerancePts(x.quotes.acceptance_rate), rateTolerancePts(other.quotes.acceptance_rate));
      if (diffPts > tolerance) {
        failures.push(fail("sources-agree", `acceptance_rate ${(ra * 100).toFixed(2)}% vs other source's ${(rb * 100).toFixed(2)}% (diff ${diffPts.toFixed(2)} pt, allowed ${tolerance})`));
      }
    }
  }

  return failures;
}

/** One document's figures as `entryFromPicks` reads them: its extraction, where it was read, and the page to cite. */
export interface PickSource {
  e: Extraction;
  url: string;
  kind: ReportedSourceKind;
  retrieved: string;
  page?: number | null;
}

/** Every value an entry can carry, each picked from one document. */
export type PickKey = QualifiedFigure | "enrollment_target" | "deposits";

/**
 * Assembles a published entry for the class `term` ("Fall 2026") from one document per value (lib/reported-combine.ts
 * picks them; `toReportedEntry` picks everything from one). `picks.acceptance_rate` is a stated rate; without one the rate
 * is admitted ÷ applicants only when both counts are exact. Deposits give way to an enrolled count (the census count
 * replaces them). `approx`, `enrollment_target` and `deposits` are written only when present, so an entry of exact
 * figures has the same shape as before the fall-figures build. Each value cites its own document; the block's
 * entering_term, year and source_kind cite the document that supplied applicants (else admitted, enrolled, the class
 * goal, deposits, then the rate). Throws when nothing was picked or the term isn't "Fall YYYY".
 */
export function entryFromPicks(term: string, picks: Partial<Record<PickKey, PickSource>>, unitId: string, run: string): ReportedEntry {
  const year = fallYear(term);
  if (year === null) throw new Error(`entryFromPicks: entering_term "${term}" isn't a recognizable "Fall YYYY"`);
  const p: Partial<Record<PickKey, PickSource>> = { ...picks };
  if (p.enrolled && p.enrolled.e.enrolled !== null) delete p.deposits;
  const meta = p.applicants ?? p.admitted ?? p.enrolled ?? p.enrollment_target ?? p.deposits ?? p.acceptance_rate;
  if (!meta) throw new Error(`entryFromPicks: no figures for ${term}`);
  const value = (k: PickKey): number | null => p[k]?.e[k] ?? null;

  // The rate: as the college stated it, else computed from two exact counts (never from a rounded one).
  let acceptance_rate: number | null = null;
  let rateFrom: "stated" | "computed" | null = null;
  if (p.acceptance_rate && p.acceptance_rate.e.acceptance_rate !== null) {
    acceptance_rate = p.acceptance_rate.e.acceptance_rate;
    rateFrom = "stated";
  } else if (p.applicants && p.admitted && !isApprox(p.applicants.e, "applicants") && !isApprox(p.admitted.e, "admitted")) {
    const ap = value("applicants");
    const ad = value("admitted");
    if (ap !== null && ad !== null && ap > 0) {
      acceptance_rate = ad / ap;
      rateFrom = "computed";
    }
  }

  const approx: NonNullable<ReportedAdmissions["approx"]> = {};
  for (const k of ["applicants", "admitted", "enrolled"] as const) if (p[k] && value(k) !== null && isApprox(p[k]!.e, k)) approx[k] = true;
  if (rateFrom === "stated" && isApprox(p.acceptance_rate!.e, "acceptance_rate")) approx.acceptance_rate = true;
  const target = value("enrollment_target");
  const deposits = value("deposits");

  const admissions: ReportedAdmissions = {
    entering_term: `Fall ${year}`,
    year,
    applicants: value("applicants"),
    admitted: value("admitted"),
    enrolled: value("enrolled"),
    acceptance_rate,
    ...(Object.keys(approx).length ? { approx } : {}),
    ...(target !== null ? { enrollment_target: target } : {}),
    ...(deposits !== null ? { deposits } : {}),
    source_kind: meta.kind,
  };

  const base = (s: PickSource) => ({
    source: "college-site" as const,
    method: "extracted" as const,
    year: `Fall ${year}`,
    url: s.url,
    retrieved: s.retrieved,
    ...(s.page != null ? { page: s.page } : {}),
  });

  // Any quote in hand, for the block's own metadata (entering_term, year, source_kind): they aren't individually
  // quoted numbers, but the lineage guard (lib/lineage.ts validateSchool) requires every registered reported.* path
  // to carry its own `extracted` record, so they cite the metadata document via whichever number's quote is available.
  const q = meta.e.quotes;
  const anyQuote = q.applicants ?? q.admitted ?? q.enrolled ?? q.acceptance_rate ?? q.enrollment_target ?? q.deposits ?? meta.e.entering_term ?? `Fall ${year}`;

  const lineage: Partial<Record<ReportedValuePath, LineageRecord>> = {
    "reported.admissions.entering_term": { ...base(meta), quote: anyQuote },
    "reported.admissions.year": { ...base(meta), quote: anyQuote },
    "reported.admissions.source_kind": { ...base(meta), quote: anyQuote },
  };
  for (const k of ["applicants", "admitted", "enrolled"] as const) {
    if (value(k) !== null) lineage[`reported.admissions.${k}`] = { ...base(p[k]!), quote: p[k]!.e.quotes[k]! };
  }
  if (rateFrom === "stated") lineage["reported.admissions.acceptance_rate"] = { ...base(p.acceptance_rate!), quote: p.acceptance_rate!.e.quotes.acceptance_rate! };
  else if (rateFrom === "computed") {
    const quote = `${p.admitted!.e.quotes.admitted} / ${p.applicants!.e.quotes.applicants}`;
    // From one document: extracted from it, as before. From two (a March release and a September one): derived.
    lineage["reported.admissions.acceptance_rate"] = p.admitted!.url === p.applicants!.url ? { ...base(p.applicants!), quote } : { ...base(p.applicants!), method: "derived", quote };
  }
  // `approx` is stored, so it is registered and cited like source_kind: the first approximate figure's document and quote.
  const firstApprox = (["applicants", "admitted", "enrolled", "acceptance_rate"] as const).find((k) => approx[k]);
  if (firstApprox) lineage["reported.admissions.approx"] = { ...base(p[firstApprox]!), quote: p[firstApprox]!.e.quotes[firstApprox]! };
  if (target !== null) lineage["reported.admissions.enrollment_target"] = { ...base(p.enrollment_target!), quote: p.enrollment_target!.e.quotes.enrollment_target! };
  if (deposits !== null) lineage["reported.admissions.deposits"] = { ...base(p.deposits!), quote: p.deposits!.e.quotes.deposits! };

  return { unit_id: unitId, admissions, lineage, run };
}

/**
 * Builds the published entry for one extraction that passed every check: a thin wrapper over `entryFromPicks` with
 * every value from that document (lib/reported-combine.ts combineByTerm does the same across documents). Throws if
 * `entering_term` doesn't parse to a fall year — callers only reach this after `runChecks` returned no failures, which
 * already guards that.
 */
export function toReportedEntry(x: Extraction | StoredExtraction, school: School, src: { url: string; kind: ReportedSourceKind; retrieved: string; page?: number | null }, run: string): ReportedEntry {
  const e = normalizeExtraction(x);
  if (fallYear(e.entering_term) === null) throw new Error(`toReportedEntry: entering_term "${e.entering_term}" isn't a recognizable "Fall YYYY"`);
  const s: PickSource = { e, url: src.url, kind: src.kind, retrieved: src.retrieved, page: src.page };
  const picks: Partial<Record<PickKey, PickSource>> = {};
  for (const k of ["applicants", "admitted", "enrolled", "acceptance_rate", "enrollment_target", "deposits"] as const) if (e[k] !== null) picks[k] = s;
  return entryFromPicks(e.entering_term!, picks, school.unit_id, run);
}

/**
 * A published entry as `school.reported` + `school.lineage` patches, for the sync to merge in: the whole block (with
 * `approx`, `enrollment_target` and `deposits` when present) and every value's own record.
 */
export function reportedToPatch(entry: ReportedEntry): { reported: ReportedData; lineage: Partial<Record<FieldPath, LineageRecord>> } {
  return {
    reported: { admissions: entry.admissions },
    lineage: entry.lineage as Partial<Record<FieldPath, LineageRecord>>,
  };
}

/** The rate as the document printed it ("42%", "4.0 percent"), from its quote; null when the quote has none. */
export function quotedRate(quote: string | undefined): string | null {
  const m = /(\d+(?:\.\d+)?)\s*(%|percent)/i.exec(quote ?? "");
  return m ? `${m[1]}%` : null;
}

/** How far a stated rate may sit from the computed one, in points, given how many decimals the document printed. */
export function rateTolerancePts(quote: string | undefined): number {
  const printed = quotedRate(quote);
  if (!printed) return 0.1;
  const decimals = (printed.split(".")[1] ?? "").replace("%", "").length;
  return decimals === 0 ? 0.5 : decimals === 1 ? 0.1 : 0.05;
}
