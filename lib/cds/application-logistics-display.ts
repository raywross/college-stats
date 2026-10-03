/**
 * Showing CDS application logistics and high school preparation (specs/data-expansion/cds-application-logistics.md):
 * the Admissions page's "Applying" and "What you'll need in high school" lines, the fee-waiver caveat, Explore's
 * gap-year chip, and Compare's two rows. Computed at render time from `school.reported.admissions_logistics` and
 * `admissions_hs_prep` (stored by lib/cds/application-logistics.ts).
 *
 * Partial, self-reported coverage: none of this feeds METRICS, ranks, medians, percentiles, sorts, Key differences, or
 * "Known for" (tests/cds-application-logistics.test.mts guards it). Years never appear here as literals: the cycle comes
 * from the stored block ("Fall 2026"), itself from the record's year label.
 *
 * Pure (imports only pure modules), so client components and Node tests load it directly.
 */
import type { CdsDate, ReportedHsPrep, ReportedLogistics, School, UnitsBySubject } from "../types";
import { formatCdsDate } from "../cds-dates.ts";
import { money } from "../format.ts";

type L = ReportedLogistics;

/** "fall 2026" from the stored cycle ("Fall 2026"), for "Apply by January 5 for fall 2026". */
export const cycleText = (l: Pick<L, "cycle">) => l.cycle.replace(/^Fall/, "fall");

/** A date, or the college's own words when the cell held text (the lineage quote's answer); null without either. */
function dateOr(d: CdsDate | null, fallback: string | null = null): string | null {
  return formatCdsDate(d) ?? fallback;
}

/** "Apply by January 5 for fall 2026." Null without a closing date. */
export function deadlineSentence(l: L): string | null {
  const d = formatCdsDate(l.regular_closing);
  return d ? `Apply by ${d} for ${cycleText(l)}.` : null;
}

/** "Priority date: November 1." */
export function prioritySentence(l: L): string | null {
  const d = formatCdsDate(l.priority_date);
  return d ? `Priority date: ${d}. Applying by then can matter for scholarships, programs, or housing.` : null;
}

/** How the college notifies. Null when the CDS left C16 blank. */
export function notificationSentence(l: L): string | null {
  const n = l.notification;
  if (!n) return null;
  if (n.kind === "rolling") {
    const d = dateOr(n.rolling_from);
    return d ? `Decisions are sent on a rolling basis starting ${d}.` : "Decisions are sent on a rolling basis.";
  }
  if (n.kind === "by_date") {
    const d = dateOr(n.by_date);
    return d ? `Decisions are sent by ${d}.` : "Decisions are sent by a set date.";
  }
  const d = dateOr(n.other_date, n.other_text);
  return d ? `Decisions are sent: ${d}.` : null;
}

/** The reply-by rule. Open question 1: "within N weeks" isn't turned into a date. */
export function replySentence(l: L): string | null {
  const r = l.reply;
  if (!r) return null;
  switch (r.kind) {
    case "fixed_date": {
      const d = formatCdsDate(r.date);
      return d ? `Admitted students must reply by ${d}.` : "Admitted students must reply by a set date.";
    }
    case "may1_or_weeks":
      return r.weeks !== null
        ? `Admitted students must reply by May 1, or within ${r.weeks} week${r.weeks === 1 ? "" : "s"} if admitted later.`
        : "Admitted students must reply by May 1, or within a few weeks if admitted later.";
    case "no_set_date":
      return "There's no set reply date.";
    case "other":
      return r.other_text ? `Reply policy: ${r.other_text}.` : null;
  }
}

const REFUND: Record<"full" | "partial" | "no", string> = { full: "refundable", partial: "partly refundable", no: "non-refundable" };

/** "$350 housing deposit, due May 1, non-refundable." Null without any part. */
export function depositSentence(l: L): string | null {
  const h = l.housing_deposit;
  if (!h) return null;
  const due = formatCdsDate(h.due);
  const refund = h.refundable ? REFUND[h.refundable] : null;
  if (h.amount === null && !due) return refund ? `The housing deposit is ${refund}.` : null;
  const head = h.amount !== null ? `${money(h.amount)} housing deposit` : "Housing deposit";
  return [head, due && `due ${due}`, refund].filter(Boolean).join(", ") + ".";
}

/**
 * "Admitted students may postpone enrollment (a gap year), up to 2 Year." Null when not allowed or unknown: never
 * "No" as a headline (the spec's display rule).
 */
export function gapYearSentence(l: L): string | null {
  const d = l.deferred_admission;
  if (!d || d.allowed !== true) return null;
  return d.max_postponement
    ? `Admitted students may postpone enrollment for a gap year. Longest postponement: ${d.max_postponement}.`
    : "Admitted students may postpone enrollment for a gap year.";
}

/** The fee-waiver caveat under the application fee. */
export function feeWaiverSentence(l: L | undefined): string | null {
  const f = l?.fee;
  if (!f) return null;
  if (f.waiver === true || f.online_waiver === true) return "Can be waived for applicants with financial need.";
  return null;
}

/** The "Applying" block's lines, in order (each null line omitted). */
export function applyingLines(s: Pick<School, "reported">): { key: keyof L; text: string }[] {
  const l = s.reported?.admissions_logistics;
  if (!l) return [];
  const lines: { key: keyof L; text: string | null }[] = [
    { key: "regular_closing", text: deadlineSentence(l) },
    { key: "priority_date", text: prioritySentence(l) },
    { key: "notification", text: notificationSentence(l) },
    { key: "reply", text: replySentence(l) },
    { key: "housing_deposit", text: depositSentence(l) },
    { key: "deferred_admission", text: gapYearSentence(l) },
  ];
  return lines.filter((x): x is { key: keyof L; text: string } => x.text !== null);
}

/* ------------------------------------------------------------------ */
/* High school preparation                                             */
/* ------------------------------------------------------------------ */

/** The by-subject table's rows (the spec's six, plus electives when given). Lab is a note on science. */
export const HS_SUBJECT_ROWS = [
  { key: "english", label: "English" },
  { key: "math", label: "Math" },
  { key: "science", label: "Science" },
  { key: "foreign_language", label: "Foreign language" },
  { key: "social_studies", label: "Social studies" },
  { key: "history", label: "History" },
  { key: "electives", label: "Academic electives" },
] as const satisfies readonly { key: keyof UnitsBySubject; label: string }[];

/** "Requires a high school diploma and accepts the GED." from the template's own wording, else the wording itself. */
export function completionSentence(h: ReportedHsPrep): string | null {
  const c = h.completion;
  if (!c) return null;
  if (/diploma is required and GED is accepted/i.test(c)) return "Requires a high school diploma; accepts the GED.";
  if (/diploma is required and GED is not accepted/i.test(c)) return "Requires a high school diploma; doesn't accept the GED.";
  if (/diploma or equivalent is not required/i.test(c)) return "Doesn't require a high school diploma or equivalent.";
  return `${c}.`;
}

export function collegePrepSentence(h: ReportedHsPrep): string | null {
  switch (h.college_prep) {
    case "required":
      return "Requires a college-preparatory program in high school.";
    case "recommended":
      return "Recommends a college-preparatory program in high school.";
    case "neither":
      return "Neither requires nor recommends a set college-preparatory program.";
    default:
      return null;
  }
}

/** The C5 table rows with at least one column filled; empty when the college gave no units (block omitted then). */
export function unitRows(h: ReportedHsPrep): { label: string; required: number | null; recommended: number | null; lab?: { required: number | null; recommended: number | null } }[] {
  const req = h.units_required;
  const rec = h.units_recommended;
  if (!req && !rec) return [];
  return HS_SUBJECT_ROWS.map((r) => ({
    label: r.label,
    required: req?.[r.key] ?? null,
    recommended: rec?.[r.key] ?? null,
    ...(r.key === "science" && (req?.lab != null || rec?.lab != null) ? { lab: { required: req?.lab ?? null, recommended: rec?.lab ?? null } } : {}),
  })).filter((r) => r.required !== null || r.recommended !== null);
}

/** The "What you'll need in high school" block shows only when C5 has units (C3/C4 alone are too thin, per U10). */
export const showsHsPrep = (s: Pick<School, "reported">) => {
  const h = s.reported?.admissions_hs_prep;
  return !!h && unitRows(h).length > 0;
};

/* ------------------------------------------------------------------ */
/* Explore: one boolean chip                                           */
/* ------------------------------------------------------------------ */

export type LogisticsFilterParam = "gapYear";

/** C.1801 answered "Yes" in the newest CDS. Colleges without one never match. */
export const allowsGapYear = (s: Pick<School, "reported">) => s.reported?.admissions_logistics?.deferred_admission?.allowed === true;

export const LOGISTICS_FILTERS: readonly { param: LogisticsFilterParam; label: string; test: (s: School) => boolean }[] = [
  { param: "gapYear", label: "Allows deferred admission (gap year)", test: allowsGapYear },
];

/* ------------------------------------------------------------------ */
/* Compare                                                             */
/* ------------------------------------------------------------------ */

/** "Jan 5 · reply May 1 · $350 deposit", or null without any (the row shows only for colleges with the data). */
export function compareDeadlines(s: Pick<School, "reported">): string | null {
  const l = s.reported?.admissions_logistics;
  if (!l) return null;
  const closing = formatCdsDate(l.regular_closing);
  const r = l.reply;
  const reply =
    r?.kind === "fixed_date" && formatCdsDate(r.date)
      ? `reply by ${formatCdsDate(r.date)}`
      : r?.kind === "may1_or_weeks"
        ? `reply by May 1${r.weeks !== null ? ` or ${r.weeks} wk` : ""}`
        : r?.kind === "no_set_date"
          ? "no set reply date"
          : null;
  const deposit = l.housing_deposit?.amount != null ? `${money(l.housing_deposit.amount)} housing deposit` : null;
  const parts = [closing && `apply by ${closing}`, reply, deposit].filter(Boolean) as string[];
  if (!parts.length) return null;
  const text = parts.join(" · ");
  return text[0].toUpperCase() + text.slice(1);
}

/** "Yes" / "Yes, up to 2 Year" / "No"; null when the CDS didn't say. */
export function compareGapYear(s: Pick<School, "reported">): string | null {
  const d = s.reported?.admissions_logistics?.deferred_admission;
  if (!d || d.allowed === null) return null;
  if (!d.allowed) return "No";
  return d.max_postponement ? `Yes, up to ${d.max_postponement}` : "Yes";
}
