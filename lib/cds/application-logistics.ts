/**
 * CDS application logistics and high school preparation (specs/data-expansion/cds-application-logistics.md): a
 * college's round-3 record (data/cds-records/<unit_id>.json) → `school.reported.admissions_logistics` (C13–C18, the
 * regular round) and `school.reported.admissions_hs_prep` (C3–C5), with one lineage record per stored block.
 *
 * Which document. Only the college's newest document: each edition fully replaces the previous one, and a blank item
 * shows nothing, never last year's now-expired date. Only **passed** items are read. A block whose own checks fail is
 * left out (it waits for review); the others still merge.
 *
 * Years. C13–C18 describe the cycle that opens after the edition's own class: a 2025–26 edition is applying for fall
 * 2026 (the record's `next-cycle` label, "Fall 2026 cycle"). C3–C5 are standing policy: their year is the edition label
 * ("2025–26"). C21/C22 (early rounds) belong to cds-admissions.md; they are read here only for the
 * "regular closing on or after early closing" check.
 *
 * Pure: type-only imports plus lib/cds-records.ts and lib/cds-dates.ts (both pure). Display helpers live in
 * lib/cds/application-logistics-display.ts so client code never loads the records helpers.
 */
import type { CdsDate, LineageRecord, ReportedHsPrep, ReportedLogistics, School, UnitsBySubject } from "../types";
import type { CdsCode, CollegeRecord, DocumentRecord } from "../cds-sections.ts";
import { compareDocuments, editionFallYear, editionLabel, itemBoolean, itemNumber, itemText, itemValue, lineageFromItem, passedItem } from "../cds-records.ts";
import { compareInCycle, dateCheck, formatCdsDate, isConcrete, parseCdsDate, splitCdsDate } from "../cds-dates.ts";

/** Every lineage path this module writes starts with one of these, so a re-merge can remove the previous ones. */
export const LOGISTICS_LINEAGE_PREFIX = "reported.admissions_logistics.";
export const HS_PREP_LINEAGE_PREFIX = "reported.admissions_hs_prep.";

/* ------------------------------------------------------------------ */
/* Codes                                                               */
/* ------------------------------------------------------------------ */

export const LOGISTICS_CODES = {
  feeWaiver: "C.1303",
  onlineFee: "C.1304",
  onlineWaiver: "C.1305",
  closingMonth: "C.1402",
  closingDay: "C.1403",
  priorityMonth: "C.1404",
  priorityDay: "C.1405",
  otherTerms: "C.1501",
  rolling: "C.1601",
  rollingMonth: "C.1602",
  rollingDay: "C.1603",
  byDate: "C.1604",
  byMonth: "C.1605",
  byDay: "C.1606",
  other: "C.1607",
  otherDate: "C.1608",
  replyFixed: "C.1701",
  replyMonth: "C.1702",
  replyDay: "C.1703",
  replyNoSet: "C.1704",
  replyMay1: "C.1705",
  replyWeeks: "C.1706",
  replyOther: "C.1707",
  replyOtherText: "C.1708",
  depositMonth: "C.1709",
  depositDay: "C.1710",
  depositAmount: "C.1711",
  depositRefund: "C.1712",
  deferAllowed: "C.1801",
  deferMax: "C.1802",
  completion: "C.301",
  collegePrep: "C.401",
} as const satisfies Record<string, CdsCode>;

/** The early rounds' closing dates (cds-admissions.md's items), for the regular-after-early check only. */
export const EARLY_CLOSING_CODES: readonly (readonly [CdsCode, CdsCode, string])[] = [
  ["C.2102", "C.2103", "early decision"],
  ["C.2106", "C.2107", "second early decision"],
  ["C.2202", "C.2203", "early action"],
];

/** The C5 subjects in table order; `lab` is a subset of science, never an addend. */
export const UNIT_SUBJECTS = ["english", "math", "science", "lab", "foreign_language", "social_studies", "history", "electives", "computer_science", "arts"] as const;
export type UnitSubject = (typeof UNIT_SUBJECTS)[number];
/** The subjects that add up to the total (everything but lab). */
export const SUMMED_SUBJECTS = UNIT_SUBJECTS.filter((s) => s !== "lab");

const unitCodes = (start: number) => {
  const code = (i: number) => `C.${start + i}` as CdsCode;
  return {
    total: code(0),
    subjects: Object.fromEntries(UNIT_SUBJECTS.map((s, i) => [s, code(i + 1)])) as Record<UnitSubject, CdsCode>,
    other: code(11),
  };
};
/** C.501–C.512 required, C.513–C.524 recommended. */
export const UNIT_CODES = { required: unitCodes(501), recommended: unitCodes(513) } as const;

/** Short labels for generated workbook quotes (a cell's value alone doesn't say which question it answers). */
const SHORT: Partial<Record<CdsCode, string>> = {
  "C.1303": "Fee waived for financial need",
  "C.1304": "Online application fee",
  "C.1305": "Online fee waived for financial need",
  "C.1402": "Closing date month",
  "C.1403": "day",
  "C.1404": "Priority date month",
  "C.1405": "day",
  "C.1501": "Accepted for terms other than fall",
  "C.1601": "Notified on a rolling basis",
  "C.1602": "beginning month",
  "C.1603": "day",
  "C.1604": "Notified by",
  "C.1605": "month",
  "C.1606": "day",
  "C.1607": "Notified, other",
  "C.1608": "Other",
  "C.1701": "Must reply by (date)",
  "C.1702": "month",
  "C.1703": "day",
  "C.1704": "No set date",
  "C.1705": "Must reply by May 1st or within weeks",
  "C.1706": "weeks",
  "C.1707": "Other",
  "C.1708": "Other",
  "C.1709": "Housing deposit due month",
  "C.1710": "day",
  "C.1711": "amount",
  "C.1712": "refundable if not enrolling",
  "C.1801": "May postpone enrollment after admission",
  "C.1802": "maximum postponement",
  "C.301": "High school completion requirement",
  "C.401": "General college-preparatory program",
  ...unitLabels("required", 501),
  ...unitLabels("recommended", 513),
};

/** "Units required, total", "English", "math", … for C.501–C.512 and C.513–C.524 (the field label names the column). */
function unitLabels(column: string, start: number): Record<CdsCode, string> {
  const words = ["total", "English", "math", "science", "lab", "language", "social studies", "history", "electives", "computer science", "arts", "other"];
  return Object.fromEntries(words.map((w, i) => [`C.${start + i}`, i === 0 ? `Units ${column}, total` : w]));
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export type LogisticsCheck =
  | "valid-date"
  | "regular-after-early"
  | "reply-after-notification"
  | "one-mark"
  | "units-sum"
  | "recommended-at-least-required"
  | "lab-within-science";

/** A check failure, naming the stored block it keeps out (which waits for review). */
export interface LogisticsFailure {
  check: LogisticsCheck;
  block: keyof ReportedLogistics | keyof ReportedHsPrep;
  detail: string;
}

/**
 * The single-select rows (C16 notification kind, C17 reply kind; C3/C4 are one choice cell in the workbook): exactly
 * one mark passes, none is blank, more than one fails.
 */
export function oneMark(marks: readonly (boolean | null)[]): "one" | "none" | "many" {
  const n = marks.filter((m) => m === true).length;
  return n === 0 ? "none" : n === 1 ? "one" : "many";
}

/** "Regular closing on/after early closing": the regular date may not come before any early round's closing date. */
export function checkRegularAfterEarly(regular: CdsDate | null, early: readonly { date: CdsDate; label: string }[]): string | null {
  if (!isConcrete(regular)) return null;
  for (const e of early) {
    if (isConcrete(e.date) && compareInCycle(regular, e.date) < 0) {
      return `regular closing ${formatCdsDate(regular)} is before the ${e.label} closing ${formatCdsDate(e.date)}`;
    }
  }
  return null;
}

/** The notification date a reply date can be compared with: a "by" date, or an "other" answer that reads as a date. */
export function concreteNotification(n: ReportedLogistics["notification"]): CdsDate | null {
  if (!n) return null;
  if (n.kind === "by_date" && isConcrete(n.by_date)) return n.by_date;
  if (n.kind === "other" && isConcrete(n.other_date)) return n.other_date;
  return null;
}

/**
 * "Reply on/after notification": `passed` or `failed` when both are concrete dates; `skipped` (not checkable, never
 * counted as passed) for a rolling notification, a "May 1 or N weeks" reply, or any other pair without two dates.
 */
export function checkReplyAfterNotification(n: ReportedLogistics["notification"], r: ReportedLogistics["reply"]): "passed" | "failed" | "skipped" {
  const notified = concreteNotification(n);
  if (!r || r.kind !== "fixed_date" || !isConcrete(r.date) || !notified || !isConcrete(notified)) return "skipped";
  return compareInCycle(r.date, notified) >= 0 ? "passed" : "failed";
}

/** The sum of the subjects that make up a total (lab excluded); null when none is filled. */
export function sumUnits(u: Pick<UnitsBySubject, (typeof SUMMED_SUBJECTS)[number]>): number | null {
  const parts = SUMMED_SUBJECTS.map((s) => u[s]).filter((v): v is number => v !== null);
  return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

/** C5's per-column checks: the total equals its parts within 1 unit, and lab ≤ science. */
export function checkUnits(u: UnitsBySubject, column: "required" | "recommended"): LogisticsFailure[] {
  const block = column === "required" ? "units_required" : "units_recommended";
  const out: LogisticsFailure[] = [];
  const sum = sumUnits(u);
  if (u.total !== null && !u.total_summed && sum !== null && Math.abs(u.total - sum) > 1) {
    out.push({ check: "units-sum", block, detail: `${column} total ${u.total} but the subjects add up to ${sum}` });
  }
  if (u.lab !== null && u.science !== null && u.lab > u.science) {
    out.push({ check: "lab-within-science", block, detail: `${column} lab units ${u.lab} > science ${u.science}` });
  }
  return out;
}

/** Recommended ≥ required, per subject, when both columns have the subject. */
export function checkRecommendedAtLeastRequired(req: UnitsBySubject | null, rec: UnitsBySubject | null): LogisticsFailure[] {
  if (!req || !rec) return [];
  return SUMMED_SUBJECTS.filter((s) => req[s] !== null && rec[s] !== null && rec[s]! < req[s]!).map((s) => ({
    check: "recommended-at-least-required" as const,
    block: "units_recommended" as const,
    detail: `${s}: recommended ${rec[s]} < required ${req[s]}`,
  }));
}

/* ------------------------------------------------------------------ */
/* Reading one document                                                */
/* ------------------------------------------------------------------ */

/** True when an item was answered at all (passed, any type): a text answer in a date cell still counts. */
const answered = (doc: DocumentRecord, code: CdsCode) => passedItem(doc, code) !== null;

/** A split month/day date from two items: concrete, free text (both null), invalid (a failure), or not answered. */
function readSplitDate(doc: DocumentRecord, monthCode: CdsCode, dayCode: CdsCode, block: LogisticsFailure["block"], failures: LogisticsFailure[]): CdsDate | null {
  if (!answered(doc, monthCode) && !answered(doc, dayCode)) return null;
  const m = itemValue(doc, monthCode);
  const d = itemValue(doc, dayCode);
  const check = dateCheck([m, d]);
  if (check === "invalid") {
    failures.push({ check: "valid-date", block, detail: `${monthCode}/${dayCode}: month ${m}, day ${d} isn't a calendar date` });
    return null;
  }
  return check === "valid" ? splitCdsDate(m, d) : { month: null, day: null };
}

/** A one-cell date item (C.1608): the stored "--MM-DD", or an Excel serial if a workbook kept one as text. */
function readCellDate(doc: DocumentRecord, code: CdsCode): CdsDate | null {
  const v = itemValue(doc, code);
  if (v === null) return null;
  return parseCdsDate(v, { excel: doc.type.startsWith("xlsx") });
}

const textOrNull = (s: string | null) => (s && s.trim() ? s.trim() : null);

/** C.1801: a boolean only from a real yes/no; "Yes or No" (the template's unanswered placeholder) is never true. */
export function deferAllowed(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

/** C.1304: "Same fee" → true, "Different fee" → false. */
export function onlineSame(v: string | null): boolean | null {
  if (!v) return null;
  if (/same/i.test(v)) return true;
  if (/differ/i.test(v)) return false;
  return null;
}

/** C.1712: "Yes" → full, "Partial…" → partial, "No" → no. */
export function refundable(v: unknown): "full" | "partial" | "no" | null {
  if (typeof v === "boolean") return v ? "full" : "no";
  if (typeof v !== "string") return null;
  if (/partial/i.test(v)) return "partial";
  if (/^\s*(yes|full)/i.test(v)) return "full";
  if (/^\s*no/i.test(v)) return "no";
  return null;
}

/** C.401: "Require" / "Recommend" / "Neither require nor recommend". */
export function collegePrep(v: string | null): ReportedHsPrep["college_prep"] {
  if (!v) return null;
  if (/neither/i.test(v)) return "neither";
  if (/^\s*requir/i.test(v)) return "required";
  if (/^\s*recommend/i.test(v)) return "recommended";
  return null;
}

/** One C5 column, or null when every cell is blank (Cornell's "-" throughout). A blank total is summed from its parts. */
export function readUnits(doc: DocumentRecord, column: "required" | "recommended"): UnitsBySubject | null {
  const codes = UNIT_CODES[column];
  const u = { total: itemNumber(doc, codes.total) } as UnitsBySubject;
  for (const s of UNIT_SUBJECTS) u[s] = itemNumber(doc, codes.subjects[s]);
  u.other_text = textOrNull(itemText(doc, codes.other));
  if (u.total === null && UNIT_SUBJECTS.every((s) => u[s] === null) && u.other_text === null) return null;
  if (u.total === null) {
    const sum = sumUnits(u);
    if (sum !== null) {
      u.total = sum;
      u.total_summed = true;
    }
  }
  return u;
}

/** Why a document's blocks were or weren't merged, for the run summary and tests. */
export interface LogisticsOutcome {
  edition: string;
  failures: LogisticsFailure[];
  /** Checks that couldn't be made (recorded as "not checkable", never as passed). */
  skipped: { check: LogisticsCheck; detail: string }[];
}

/** The two blocks of one document, before lineage: values, the codes behind each block, and failures. */
export function readLogistics(doc: DocumentRecord): {
  logistics: Omit<ReportedLogistics, "cycle" | "edition">;
  hsPrep: ReportedHsPrep;
  sources: Partial<Record<keyof ReportedLogistics | keyof ReportedHsPrep, CdsCode[]>>;
  outcome: LogisticsOutcome;
} {
  const K = LOGISTICS_CODES;
  const failures: LogisticsFailure[] = [];
  const skipped: LogisticsOutcome["skipped"] = [];
  const sources: Partial<Record<keyof ReportedLogistics | keyof ReportedHsPrep, CdsCode[]>> = {};
  const used = (block: keyof ReportedLogistics | keyof ReportedHsPrep, codes: CdsCode[]) => {
    const passed = codes.filter((c) => answered(doc, c));
    if (passed.length) sources[block] = passed;
  };

  // C13 fee waivers (the fee amount itself is admissions.application_fee, from IPEDS).
  const fee = { waiver: itemBoolean(doc, K.feeWaiver), online_same: onlineSame(itemText(doc, K.onlineFee)), online_waiver: itemBoolean(doc, K.onlineWaiver) };
  used("fee", [K.feeWaiver, K.onlineFee, K.onlineWaiver]);

  // C14
  let regular = readSplitDate(doc, K.closingMonth, K.closingDay, "regular_closing", failures);
  used("regular_closing", [K.closingMonth, K.closingDay]);
  const early = EARLY_CLOSING_CODES.map(([m, d, label]) => ({ date: splitCdsDate(itemNumber(doc, m), itemNumber(doc, d)), label }));
  const earlyProblem = checkRegularAfterEarly(regular, early);
  if (earlyProblem) {
    failures.push({ check: "regular-after-early", block: "regular_closing", detail: earlyProblem });
    regular = null;
  }
  const priority = readSplitDate(doc, K.priorityMonth, K.priorityDay, "priority_date", failures);
  used("priority_date", [K.priorityMonth, K.priorityDay]);

  // C15: stored, never displayed.
  const otherTerms = itemBoolean(doc, K.otherTerms);
  used("other_terms", [K.otherTerms]);

  // C16
  let notification: ReportedLogistics["notification"] = null;
  const nMarks = [itemBoolean(doc, K.rolling), itemBoolean(doc, K.byDate), itemBoolean(doc, K.other)];
  const nm = oneMark(nMarks);
  if (nm === "many") failures.push({ check: "one-mark", block: "notification", detail: "more than one notification option is marked (C.1601, C.1604, C.1607)" });
  else if (nm === "one") {
    const kind = (["rolling", "by_date", "other"] as const)[nMarks.indexOf(true)];
    const rolling_from = kind === "rolling" ? readSplitDate(doc, K.rollingMonth, K.rollingDay, "notification", failures) : null;
    const by_date = kind === "by_date" ? readSplitDate(doc, K.byMonth, K.byDay, "notification", failures) : null;
    const cell = kind === "other" ? readCellDate(doc, K.otherDate) : null;
    const other_date = cell && isConcrete(cell) ? cell : null;
    const other_text = kind === "other" && !other_date ? textOrNull(itemText(doc, K.otherDate)) : null;
    notification = { kind, rolling_from, by_date, other_date, other_text };
    const codes: Record<typeof kind, CdsCode[]> = { rolling: [K.rolling, K.rollingMonth, K.rollingDay], by_date: [K.byDate, K.byMonth, K.byDay], other: [K.other, K.otherDate] };
    used("notification", codes[kind]);
  }

  // C17 reply
  let reply: ReportedLogistics["reply"] = null;
  const rMarks = [itemBoolean(doc, K.replyFixed), itemBoolean(doc, K.replyNoSet), itemBoolean(doc, K.replyMay1), itemBoolean(doc, K.replyOther)];
  const rm = oneMark(rMarks);
  if (rm === "many") failures.push({ check: "one-mark", block: "reply", detail: "more than one reply option is marked (C.1701, C.1704, C.1705, C.1707)" });
  else if (rm === "one") {
    const kind = (["fixed_date", "no_set_date", "may1_or_weeks", "other"] as const)[rMarks.indexOf(true)];
    reply = {
      kind,
      date: kind === "fixed_date" ? readSplitDate(doc, K.replyMonth, K.replyDay, "reply", failures) : null,
      weeks: kind === "may1_or_weeks" ? itemNumber(doc, K.replyWeeks) : null,
      other_text: kind === "other" ? textOrNull(itemText(doc, K.replyOtherText)) : null,
    };
    const codes: Record<typeof kind, CdsCode[]> = {
      fixed_date: [K.replyFixed, K.replyMonth, K.replyDay],
      no_set_date: [K.replyNoSet],
      may1_or_weeks: [K.replyMay1, K.replyWeeks],
      other: [K.replyOther, K.replyOtherText],
    };
    used("reply", codes[kind]);
    const order = checkReplyAfterNotification(notification, reply);
    if (order === "failed") {
      failures.push({ check: "reply-after-notification", block: "reply", detail: `reply date ${formatCdsDate(reply.date)} is before notification ${formatCdsDate(concreteNotification(notification))}` });
      reply = null;
    } else if (order === "skipped") {
      skipped.push({ check: "reply-after-notification", detail: `not checkable: notification ${notification?.kind ?? "blank"}, reply ${kind}` });
    }
  }

  // C17 housing deposit
  const dueFailures: LogisticsFailure[] = [];
  const due = readSplitDate(doc, K.depositMonth, K.depositDay, "housing_deposit", dueFailures);
  failures.push(...dueFailures);
  const deposit = { due, amount: itemNumber(doc, K.depositAmount), refundable: refundable(itemValue(doc, K.depositRefund)) };
  used("housing_deposit", [K.depositMonth, K.depositDay, K.depositAmount, K.depositRefund]);

  // C18
  const deferred = { allowed: deferAllowed(itemValue(doc, K.deferAllowed)), max_postponement: textOrNull(itemText(doc, K.deferMax)) };
  used("deferred_admission", [K.deferAllowed, K.deferMax]);

  // C3–C5
  let req = readUnits(doc, "required");
  let rec = readUnits(doc, "recommended");
  const unitFailures = [...(req ? checkUnits(req, "required") : []), ...(rec ? checkUnits(rec, "recommended") : []), ...checkRecommendedAtLeastRequired(req, rec)];
  failures.push(...unitFailures);
  if (unitFailures.some((f) => f.block === "units_required")) req = null;
  if (unitFailures.some((f) => f.block === "units_recommended")) rec = null;
  const reqC = UNIT_CODES.required;
  const recC = UNIT_CODES.recommended;
  used("units_required", [reqC.total, ...Object.values(reqC.subjects), reqC.other]);
  used("units_recommended", [recC.total, ...Object.values(recC.subjects), recC.other]);
  used("completion", [K.completion]);
  used("college_prep", [K.collegePrep]);

  const failedBlock = (b: LogisticsFailure["block"]) => failures.some((f) => f.block === b);
  const logistics: Omit<ReportedLogistics, "cycle" | "edition"> = {
    fee: fee.waiver === null && fee.online_same === null && fee.online_waiver === null ? null : fee,
    regular_closing: failedBlock("regular_closing") ? null : regular,
    priority_date: failedBlock("priority_date") ? null : priority,
    other_terms: otherTerms,
    notification: failedBlock("notification") ? null : notification,
    reply: failedBlock("reply") ? null : reply,
    housing_deposit: failedBlock("housing_deposit") || (deposit.due === null && deposit.amount === null && deposit.refundable === null) ? null : deposit,
    deferred_admission: deferred.allowed === null && deferred.max_postponement === null ? null : deferred,
  };
  const hsPrep: ReportedHsPrep = {
    completion: textOrNull(itemText(doc, K.completion)),
    college_prep: collegePrep(itemText(doc, K.collegePrep)),
    units_required: req,
    units_recommended: rec,
  };
  return { logistics, hsPrep, sources, outcome: { edition: doc.edition, failures, skipped } };
}

/* ------------------------------------------------------------------ */
/* Lineage                                                             */
/* ------------------------------------------------------------------ */

const QUOTE_MAX = 160;
const clip = (s: string) => (s.length <= QUOTE_MAX ? s : `${s.slice(0, QUOTE_MAX - 1)}…`);

/** The printed answer of a workbook item: its quote is "question | answer". */
function printed(doc: DocumentRecord, code: CdsCode): string {
  const it = doc.items[code];
  const q = it?.quote ?? "";
  const bar = q.lastIndexOf(" | ");
  if (bar >= 0) return q.slice(bar + 3);
  const v = it?.v;
  return typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "");
}

/**
 * One lineage record for a block built from several items: cited to the first item (its page or cell), with a quote
 * that names each item's question and printed answer, so the ⓘ shows "Closing date month: 1; day: 5".
 */
export function blockLineage(doc: DocumentRecord, codes: readonly CdsCode[], year: string): LineageRecord {
  const anchor = codes.find((c) => passedItem(doc, c)?.quote) ?? codes[0];
  const quote = clip(codes.map((c) => `${SHORT[c] ?? c}: ${printed(doc, c)}`).join("; "));
  if (passedItem(doc, anchor)?.quote) return { ...lineageFromItem(doc, anchor, { year }), quote };
  // An item read without a quote (C.1501 is store-only): the generated quote, at its own cell.
  const it = passedItem(doc, anchor);
  if (!it) throw new Error(`${anchor}: not passed`);
  return {
    source: "college-site",
    method: "extracted",
    year,
    edition: editionLabel(doc.edition),
    url: doc.url,
    retrieved: doc.retrieved,
    quote,
    ...(it.page !== undefined ? { page: it.page } : {}),
    ...(it.cell ? { cell: it.cell } : {}),
    ...(it.field ? { field: it.field } : {}),
  };
}

/** "Fall 2026 cycle" → "Fall 2026"; from the edition when the record has no label. */
function cycleOf(doc: DocumentRecord): { cycle: string; label: string } | null {
  const label = doc.years["next-cycle"];
  const m = label ? /^Fall (\d{4})/.exec(label) : null;
  if (m && label) return { cycle: `Fall ${m[1]}`, label };
  const fall = editionFallYear(doc.edition);
  return fall === null ? null : { cycle: `Fall ${fall + 1}`, label: `Fall ${fall + 1} cycle` };
}

/**
 * Both blocks and their lineage from a college's record (its newest document only). A block is null when nothing in
 * it was answered and passed its checks.
 */
export function logisticsFromRecord(record: CollegeRecord): {
  logistics: ReportedLogistics | null;
  hsPrep: ReportedHsPrep | null;
  lineage: Record<string, LineageRecord>;
  outcome: LogisticsOutcome | null;
} {
  const doc = [...record.documents].sort(compareDocuments)[0];
  if (!doc) return { logistics: null, hsPrep: null, lineage: {}, outcome: null };
  const { logistics: l, hsPrep: h, sources, outcome } = readLogistics(doc);
  const lineage: Record<string, LineageRecord> = {};
  const cyc = cycleOf(doc);
  const editionYear = doc.years.edition ?? editionLabel(doc.edition);

  let logistics: ReportedLogistics | null = null;
  const lKeys = Object.keys(l) as (keyof typeof l)[];
  if (cyc && lKeys.some((k) => l[k] !== null)) {
    logistics = { cycle: cyc.cycle, edition: doc.edition, ...l };
    for (const k of lKeys) {
      if (l[k] !== null) lineage[`${LOGISTICS_LINEAGE_PREFIX}${k}`] = blockLineage(doc, sources[k]!, cyc.label);
    }
    // The cycle and edition cite the first block the record answered.
    const anchor = lKeys.find((k) => l[k] !== null)!;
    for (const k of ["cycle", "edition"]) lineage[`${LOGISTICS_LINEAGE_PREFIX}${k}`] = { ...lineage[`${LOGISTICS_LINEAGE_PREFIX}${anchor}`] };
  }

  let hsPrep: ReportedHsPrep | null = null;
  const hKeys = Object.keys(h) as (keyof ReportedHsPrep)[];
  if (hKeys.some((k) => h[k] !== null)) {
    hsPrep = h;
    for (const k of hKeys) {
      if (h[k] !== null) lineage[`${HS_PREP_LINEAGE_PREFIX}${k}`] = blockLineage(doc, sources[k]!, editionYear);
    }
  }
  return { logistics, hsPrep, lineage, outcome };
}

/**
 * The school with its logistics and high school blocks from `record` (or without them). Idempotent: previous blocks
 * and their lineage are removed first, and a school that ends with neither keeps its key order.
 */
export function mergeApplicationLogistics(school: School, record: CollegeRecord | undefined): School {
  const ours = (k: string) => k.startsWith(LOGISTICS_LINEAGE_PREFIX) || k.startsWith(HS_PREP_LINEAGE_PREFIX);
  const hadLineage = Object.keys(school.lineage ?? {}).some(ours);
  let out: School = school;
  if (school.reported?.admissions_logistics || school.reported?.admissions_hs_prep || hadLineage) {
    const reported = { ...school.reported };
    delete reported.admissions_logistics;
    delete reported.admissions_hs_prep;
    const lineage = Object.fromEntries(Object.entries(school.lineage ?? {}).filter(([k]) => !ours(k)));
    out = { ...school, reported, lineage };
    if (!Object.keys(reported).length) delete (out as Partial<School>).reported;
    if (!Object.keys(lineage).length) delete (out as Partial<School>).lineage;
  }
  if (!record) return out;
  const { logistics, hsPrep, lineage } = logisticsFromRecord(record);
  if (!logistics && !hsPrep) return out;
  return {
    ...out,
    lineage: { ...out.lineage, ...lineage },
    reported: { ...out.reported, ...(logistics ? { admissions_logistics: logistics } : {}), ...(hsPrep ? { admissions_hs_prep: hsPrep } : {}) },
  };
}
