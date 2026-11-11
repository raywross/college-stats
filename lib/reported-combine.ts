/**
 * Combine by term (specs/college-reported-fall-figures.md Decision 2): a college announces its newest class in pieces
 * (a March release with applicants and admitted, a September one with the enrolled count, a CDS months later), and
 * every document that names the same entering term contributes to one funnel, each figure citing its own document.
 *
 * The rule, in order:
 *  1. Each candidate is judged alone with `runChecks` (the seven checks; check 7 against every other candidate).
 *  2. The newest term (`fallYear(entering_term)`) with at least one passing candidate wins.
 *  3. A passing Common Data Set for that term supplies the whole funnel outright (Decision 8).
 *  4. Otherwise applicants, admitted and enrolled each come from the newest passing candidate (by `published`, else
 *     `retrieved`) that states it, an exact figure preferred over an approximate one; the class goal and deposits from
 *     the newest candidate that states them.
 *  5. The rate: the stated rate of the candidate that supplied applicants (with its qualifier), else admitted ÷
 *     applicants when both are exact, else the newest stated rate (a rate without counts is the college's own words).
 *  6. The assembled funnel is re-checked for order across documents (admitted ≤ applicants, enrolled ≤ admitted); a
 *     violation drops the later-published figure and records a `funnel-order` failure for review.
 *
 * Pure: no I/O. The pipeline (scripts/lib/college-reported/phases.mts publishC1) builds the candidates and queues the
 * failures; `toReportedEntry` (lib/reported-checks.ts) is the one-candidate case.
 */
import type { School, ReportedSourceKind } from "./types";
import { fallYear, type CheckFailure, type Extraction, type ReportedEntry } from "./reported.ts";
import { entryFromPicks, isApprox, normalizeExtraction, runChecks, type PickKey, type PickSource } from "./reported-checks.ts";

/** One document's extraction offered to `combineByTerm`. `published` (ISO) is a notice's own date, when known. */
export interface Candidate {
  e: Extraction;
  url: string;
  kind: ReportedSourceKind;
  retrieved: string;
  published?: string;
}

/**
 * The combined entry (null when no candidate passed), the term it describes, and what needs a person: every candidate
 * that failed a check for a reason other than "not newer than federal" (only those for the chosen term or a newer one
 * when an entry was published), plus each figure dropped by the cross-document funnel-order check.
 */
export interface Combined {
  entry: ReportedEntry | null;
  failures: { url: string; failures: CheckFailure[]; e: Extraction }[];
  term: string | null;
}

type Judged = Candidate & { e: Extraction; date: string; order: number; failures: CheckFailure[] };

const COUNTS = ["applicants", "admitted", "enrolled"] as const;

/** Newest first: by `published` (else `retrieved`), then the later candidate in the input. */
const newestFirst = (a: Judged, b: Judged) => b.date.localeCompare(a.date) || b.order - a.order;

const toPick = (c: Judged): PickSource => ({ e: c.e, url: c.url, kind: c.kind, retrieved: c.retrieved, page: c.e.page });

export function combineByTerm(candidates: Candidate[], school: School, run: string, today: string): Combined {
  const normalized = candidates.map((c) => ({ ...c, e: normalizeExtraction(c.e) }));
  const all = normalized.map((c) => c.e);
  const judged: Judged[] = normalized.map((c, order) => ({
    ...c,
    retrieved: c.retrieved || today,
    date: c.published ?? (c.retrieved || today),
    order,
    failures: runChecks(c.e, school, all),
  }));

  const VALUES = [...COUNTS, "acceptance_rate", "enrollment_target", "deposits"] as const;
  const passing = judged.filter((j) => !j.failures.length && VALUES.some((k) => j.e[k] !== null));
  const years = passing.map((j) => fallYear(j.e.entering_term)).filter((y): y is number => y !== null);
  const year = years.length ? Math.max(...years) : null;

  // Failures worth a person's look: not merely "the college hasn't published a newer year", and not superseded by a
  // newer term that published.
  const failures: Combined["failures"] = judged
    .filter((j) => j.failures.length && !j.failures.every((f) => f.check === "newer-than-federal"))
    .filter((j) => year === null || (fallYear(j.e.entering_term) ?? year) >= year)
    .map((j) => ({ url: j.url, failures: j.failures, e: j.e }));

  if (year === null) return { entry: null, failures, term: null };
  const term = `Fall ${year}`;
  const inTerm = passing.filter((j) => fallYear(j.e.entering_term) === year).sort(newestFirst);

  // 3. A Common Data Set for the term wins outright: its whole funnel, nothing from the notices.
  const cds = inTerm.filter((j) => j.kind === "cds");
  if (cds.length) {
    const figures = (j: Judged) => COUNTS.filter((k) => j.e[k] !== null).length;
    const best = [...cds].sort((a, b) => figures(b) - figures(a) || newestFirst(a, b))[0];
    const s = toPick(best);
    const picks: Partial<Record<PickKey, PickSource>> = {};
    for (const k of [...COUNTS, "acceptance_rate"] as const) if (best.e[k] !== null) picks[k] = s;
    return { entry: entryFromPicks(term, picks, school.unit_id, run), failures, term };
  }

  // 4. Figure by figure: exact before approximate, then newest.
  const picks: Partial<Record<PickKey, Judged>> = {};
  for (const k of COUNTS) {
    const stating = inTerm.filter((j) => j.e[k] !== null);
    picks[k] = stating.find((j) => !isApprox(j.e, k)) ?? stating[0];
  }
  for (const k of ["enrollment_target", "deposits"] as const) picks[k] = inTerm.find((j) => j.e[k] !== null);

  // 6. Funnel order across documents: the later-published figure of a violating pair is dropped and queued.
  for (const [lo, hi] of [["admitted", "applicants"], ["enrolled", "admitted"], ["enrolled", "applicants"]] as const) {
    const a = picks[lo];
    const b = picks[hi];
    if (!a || !b || a === b) continue;
    const va = a.e[lo]!;
    const vb = b.e[hi]!;
    if (va <= vb) continue;
    const [dropKey, dropped] = newestFirst(a, b) <= 0 ? [lo, a] : [hi, b];
    delete picks[dropKey];
    failures.push({
      url: dropped.url,
      e: dropped.e,
      failures: [{ check: "funnel-order", detail: `${lo} ${va} (${a.url}) > ${hi} ${vb} (${b.url}) across documents for ${term}; dropped the later-published ${dropKey}` }],
    });
  }

  // 5. The rate, after any drop.
  const rateFromApplicants = picks.applicants && picks.applicants.e.acceptance_rate !== null ? picks.applicants : undefined;
  const computable = picks.applicants && picks.admitted && !isApprox(picks.applicants.e, "applicants") && !isApprox(picks.admitted.e, "admitted");
  const rate = rateFromApplicants ?? (computable ? undefined : inTerm.find((j) => j.e.acceptance_rate !== null));

  const sources: Partial<Record<PickKey, PickSource>> = {};
  for (const k of [...COUNTS, "enrollment_target", "deposits"] as const) if (picks[k]) sources[k] = toPick(picks[k]!);
  if (rate) sources.acceptance_rate = toPick(rate);
  return { entry: entryFromPicks(term, sources, school.unit_id, run), failures, term };
}
