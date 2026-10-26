/**
 * "What it takes to apply" (common-app-build/brief.md "U2"): pure sentences and lines built from `school.apply`
 * (lib/common-app/types.ts `SchoolApply`), read by `components/school/WhatItTakes.tsx`. No year or cycle literals:
 * `cycleLabel` derives "this cycle"/"last cycle" from `apply.common_app.cycle` at run time, and every date is
 * formatted from its month/day without `Intl` or a `Date` object, so server and client render the same text.
 *
 * Pure module: type-only imports from lib/types.ts and lib/glossary.ts, so Node tests and client components can load
 * it directly.
 */
import type { CdsDate, ReportedLogistics } from "../types";
import type { TermKey } from "../glossary";
import type { SchoolApply } from "./types";
import { money } from "../format.ts";
import { cdsEditionAsOf } from "./test-policy.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-01" → "November 1". Never `Intl`/`Date`, so the text can't shift with a server's or browser's time zone. */
function isoMonthDayText(iso: string): string | null {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[1]) - 1];
  return month ? `${month} ${Number(m[2])}` : null;
}

/** A CDS month/day cell, both parts known. */
function concreteCdsDate(d: CdsDate | null | undefined): d is { month: number; day: number } {
  return !!d && d.month !== null && d.day !== null;
}

/** "January 5" from a CDS month/day cell; null without both parts. Same table as `isoMonthDayText`, so the two agree. */
function cdsDateText(d: CdsDate | null | undefined): string | null {
  return concreteCdsDate(d) ? (MONTHS[d.month - 1] ? `${MONTHS[d.month - 1]} ${d.day}` : null) : null;
}

/**
 * "this cycle" while today is on or before August 31 of the cycle's second year ("2026-27" ends 2027-08-31), else
 * "last cycle"; null without a cycle (a member with no grid row). `today` and the cycle are both `YYYY-MM-DD`/`YYYY-YY`
 * strings, compared lexically, so this needs no `Date` object.
 */
export function cycleLabel(cycle: string | null, today: string): "this cycle" | "last cycle" | null {
  const m = cycle ? /^(\d{4})-(\d{2})$/.exec(cycle) : null;
  if (!m) return null;
  const end = `${Number(m[1]) + 1}-08-31`;
  return today <= end ? "this cycle" : "last cycle";
}

export type RoundKey = "ed" | "ed2" | "ea" | "ea2" | "rea" | "regular";

export interface RoundLine {
  key: RoundKey;
  label: string;
  dateText: string;
}

/** Display vocabulary (brief "Shared contracts"): the words for each round, in the grid's column order. */
const ROUND_LABELS: Record<RoundKey, string> = {
  ed: "Early Decision",
  ed2: "Early Decision II",
  ea: "Early Action",
  ea2: "Early Action II",
  rea: "Restrictive Early Action",
  regular: "Regular Decision",
};

const ROUND_ORDER: readonly RoundKey[] = ["ed", "ed2", "ea", "ea2", "rea", "regular"];

/** The rounds this college offers, in grid order, each with its date text ("November 1") or "Rolling admission". */
export function roundLines(apply: SchoolApply): RoundLine[] {
  const d = apply.deadlines;
  if (!d) return [];
  const lines: RoundLine[] = [];
  for (const key of ROUND_ORDER) {
    const value = d[key];
    if (value == null) continue;
    if (key === "regular" && value === "rolling") {
      lines.push({ key, label: "Rolling", dateText: "Rolling admission" });
      continue;
    }
    const dateText = isoMonthDayText(value);
    if (dateText) lines.push({ key, label: ROUND_LABELS[key], dateText });
  }
  return lines;
}

/**
 * "No application fee." / "$50 application fee; takes the Common App fee waiver." / "… for U.S. applicants only." /
 * "… doesn't take the Common App fee waiver." The international fee is stored but never shown here (owner decision).
 */
export function feeSentence(apply: SchoolApply): string | null {
  const fee = apply.fee;
  if (!fee || fee.us == null) return null;
  if (fee.us === 0) return "No application fee.";
  const base = `${money(fee.us)} application fee`;
  switch (apply.fee_waiver) {
    case "accepted":
      return `${base}; takes the Common App fee waiver.`;
    case "us_only":
      return `${base}; takes the Common App fee waiver for U.S. applicants only.`;
    case "not_accepted":
      return `${base}; doesn't take the Common App fee waiver.`;
    default:
      return `${base}.`;
  }
}

export interface MaterialLine {
  key: "essay" | "writing_supplement" | "courses_grades" | "portfolio";
  text: string;
  term?: TermKey;
}

/**
 * Essay, writing supplement, Courses & Grades, and portfolio: the essay line shows either way (required or not); the
 * other three show only when the college requires them, never a "doesn't require" line (the grid has no reliable
 * "no" for them — see "As built (wave 1)" in prompts/U2.md).
 */
export function materialsLines(apply: SchoolApply): MaterialLine[] {
  const lines: MaterialLine[] = [];
  if (apply.essay_required != null) {
    lines.push({ key: "essay", text: apply.essay_required ? "Requires the Common App personal essay" : "Doesn't require the personal essay" });
  }
  if (apply.writing_supplement === true) {
    lines.push({ key: "writing_supplement", text: "Requires a writing supplement", term: "writing-supplement" });
  }
  if (apply.courses_grades_required === true) {
    lines.push({ key: "courses_grades", text: "Requires the Courses & Grades section", term: "courses-and-grades" });
  }
  if (apply.portfolio) {
    lines.push({
      key: "portfolio",
      text: apply.portfolio === "slideroom" ? "Portfolio through SlideRoom" : "Portfolio through the college's own system",
    });
  }
  return lines;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/** Oxford-comma join ("a, b, and c"); two items get "a and b"; one item is unchanged. */
function joinSentence(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** "Two teacher evaluations, a counselor recommendation, and a mid-year report." / "No recommendations required." */
export function recommendationsSentence(apply: SchoolApply): string | null {
  const r = apply.recommendations;
  if (!r) return null;
  const parts: string[] = [];
  if (r.teacher > 0) parts.push(`${numberWord(r.teacher)} teacher evaluation${r.teacher === 1 ? "" : "s"}`);
  if (r.other > 0) parts.push(`${numberWord(r.other)} other evaluation${r.other === 1 ? "" : "s"}`);
  if (r.counselor) parts.push("a counselor recommendation");
  if (r.mid_year_report) parts.push("a mid-year report");
  if (!parts.length) return "No recommendations required.";
  const joined = joinSentence(parts);
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/**
 * The test-policy line: `siteLabel` is the headline the rest of the site already uses for this college (from
 * `POLICY_LABELS[school.admissions.test_policy]`, lib/test-policy.ts), kept as a caller-supplied string so this stays
 * a pure function with no knowledge of how the newest-wins headline was chosen; `apply.test_policy` adds the grid's
 * own detail: `tests_used` when it's not "See website" (that phrase means the college hasn't told the grid, so it
 * adds nothing), "flexible" for code F, and "for some applicants" for code S (skipped when `siteLabel` already says
 * so, to avoid "Required for some applicants; for some applicants").
 */
export function testPolicySentence(apply: SchoolApply, siteLabel: string): string | null {
  const tp = apply.test_policy;
  if (!tp) return null;
  const extras: string[] = [];
  if (tp.code === "F" && !/flexible/i.test(siteLabel)) extras.push("flexible: the college chooses among the tests listed");
  if (tp.code === "S" && !/some applicants/i.test(siteLabel)) extras.push("for some applicants");
  if (tp.tests_used && tp.tests_used !== "See website") extras.push(`tests used: ${tp.tests_used}`);
  const body = [siteLabel, ...extras].join("; ");
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

export interface NewestRegularDeadline {
  /** Which side's regular-round date is the more recent statement. */
  winner: "grid" | "cds";
  /** The losing side's date, as text, for the muted line; null if that side has nothing concrete to show. */
  loserText: string | null;
}

/**
 * Picks between the grid's regular-round date and the college's Common Data Set `regular_closing`, by which
 * statement is newer: the grid's `updated` stamp vs. the CDS edition's as-of date (January 1 of the edition's second
 * year, the same rule the store uses for the test policy: lib/common-app/test-policy.ts `cdsEditionAsOf`; never the
 * day Quad read the document), both `YYYY-MM-DD`. Null when either side has no date to compare (rolling admission has
 * no deadline to reconcile; no CDS closing date or edition; no grid row). `components/school/ApplyingBox.tsx` drops
 * its own line when the grid wins, and `WhatItTakes` shows the loser's date as a muted line cited to its own field.
 */
export function newestRegularDeadline(
  apply: SchoolApply,
  logistics: Pick<ReportedLogistics, "regular_closing" | "edition"> | null | undefined
): NewestRegularDeadline | null {
  const gridDate = apply.deadlines?.regular ?? null;
  const gridUpdated = apply.common_app.updated;
  if (!gridDate || gridDate === "rolling" || !gridUpdated) return null;
  const cdsDate = logistics?.regular_closing ?? null;
  const cdsAsOf = cdsEditionAsOf(logistics?.edition);
  if (!concreteCdsDate(cdsDate) || !cdsAsOf) return null;
  const gridText = isoMonthDayText(gridDate);
  const cdsText = cdsDateText(cdsDate);
  if (gridUpdated > cdsAsOf) return { winner: "grid", loserText: cdsText };
  return { winner: "cds", loserText: gridText };
}
