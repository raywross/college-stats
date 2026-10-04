/**
 * The fillable-PDF reader (specs/college-reported-round-3.md, Decision 3): the official CDS PDF form's widgets carry
 * every answer, and each widget's field name is the template's "US News PDF Tag" (1,087 of Howard's 1,089 field names
 * match), so a form is read into template codes with no model call.
 *
 * Answers arrive as text fields ("10738"), checkboxes (checked or "Off"), choice lists ("11"), and radio groups whose
 * export values are short codes: C7's `VI/I/C/NC`, `Y/N`, C8's `ADMS_REQ … ADMS_NOT_USED`, D5's `TFER_REQ … TFER_NREQ`.
 * Each radio code is mapped to the words the template workbook's code table holds for the same answer ("Very
 * Important", "Required of All"), then normalized by the item's value type, so a form and a workbook give the same
 * record value.
 */
import {
  normalizeValue,
  parseAidYear,
  parseEdition,
  READER_VERSIONS,
  typeFailure,
  yearsForEdition,
  type CdsCode,
  type DocumentRecord,
  type ItemFailure,
  type ItemResult,
  type TemplateItem,
  type TemplateTable,
} from "../../../lib/cds-sections.ts";
import { quoteOf, RESPONDENT_CODES } from "../cds-xlsx.mts";
import { editionFromBody, linesFromItems, pdfTextItems } from "./layout.mts";
import { widgetFilled } from "./doctype.mts";

/** One form widget as the reader needs it. Radio buttons of one group share a name; each has its own export value. */
export interface FormWidget {
  page: number;
  name: string;
  kind: "text" | "check" | "radio" | "choice" | "other";
  /** The field's value: the text, the checkbox's state ("X" when checked), or the radio group's selected export value. */
  value: string | null;
  /** A radio button's own export value. */
  export?: string;
}

/** A pdf.js widget annotation, as much of it as the reader uses. */
export interface WidgetAnnotation {
  subtype?: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: unknown;
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: unknown;
  exportValue?: unknown;
}

const clean = (v: unknown): string | null => {
  const s = (Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v)).replace(/\s+/g, " ").trim();
  return s === "" || s === "Off" ? null : s;
};

/** One annotation as a FormWidget; null for anything that isn't a named form widget. */
export function widgetFromAnnotation(a: WidgetAnnotation, page: number): FormWidget | null {
  if (a.subtype !== "Widget" || !a.fieldName) return null;
  const name = a.fieldName.trim();
  if (a.fieldType === "Btn" && a.radioButton) return { page, name, kind: "radio", value: clean(a.fieldValue), export: clean(a.buttonValue) ?? "" };
  if (a.fieldType === "Btn" && a.checkBox) return { page, name, kind: "check", value: widgetFilled(a) ? "X" : null };
  if (a.fieldType === "Tx") return { page, name, kind: "text", value: clean(a.fieldValue) };
  if (a.fieldType === "Ch") return { page, name, kind: "choice", value: clean(a.fieldValue) };
  return { page, name, kind: "other", value: clean(a.fieldValue) };
}

/** Every form widget of a PDF, page by page, via pdf.js `page.getAnnotations()`. */
export async function readFormWidgets(bytes: Uint8Array): Promise<FormWidget[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const out: FormWidget[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    for (const a of await (await doc.getPage(p)).getAnnotations()) {
      const w = widgetFromAnnotation(a as WidgetAnnotation, p);
      if (w) out.push(w);
    }
  }
  await task.destroy();
  return out;
}

/** One field's answer: its value (null when empty), its page, its kind, and a radio group's export values in order. */
export interface FormField {
  name: string;
  page: number;
  kind: FormWidget["kind"];
  value: string | null;
  exports: string[];
}

/**
 * Widgets grouped by field name. A radio group's value is its selected export value (pdf.js repeats the group's value
 * on every button; a value matching no button's export is still kept: some forms export it with a trailing space).
 */
export function formFields(widgets: readonly FormWidget[]): Map<string, FormField> {
  const out = new Map<string, FormField>();
  for (const w of widgets) {
    const f = out.get(w.name);
    if (!f) {
      out.set(w.name, { name: w.name, page: w.page, kind: w.kind, value: w.value, exports: w.export !== undefined ? [w.export] : [] });
      continue;
    }
    if (w.export !== undefined && !f.exports.includes(w.export)) f.exports.push(w.export);
    if (f.value === null && w.value !== null) {
      f.value = w.value;
      f.page = w.page;
    }
  }
  return out;
}

/**
 * Radio export values → the words the template workbook's code table holds for the same answer (its formulas copy the
 * grid's column header). Keyed by CDS item. Y/N, N/A, and words exported as words (A2, A3) need no entry.
 */
export const RADIO_WORDS: Record<string, Record<string, string>> = {
  A4: { SEM: "Semester", QTR: "Quarter", TRI: "Trimester", "414": "4-1-4", CON: "Continuous", DFR: "Differs by program (describe):", Other: "Other (describe):" },
  C3: { GED: "High school diploma is required and GED is accepted", REQ: "High school diploma is required and GED is not accepted", NON: "High school diploma or equivalent is not required" },
  C4: { REQ: "Require", REC: "Recommend", NON: "Neither require nor recommend" },
  C7: { VI: "Very Important", I: "Important", C: "Considered", NC: "Not Considered" },
  C8: {
    ADMS_REQ: "Required to be considered for admission",
    ADMS_RFS: "Required for some",
    ADMS_REC: "Recommended",
    ADMS_CONSIDER: "Not required for admission, but considered if submitted",
    ADMS_NOT_USED: "Not considered for admission, even if submitted",
  },
  C13: { SAME: "Same fee", FREE: "Free", RED: "Reduced" },
  C17: { F: "Yes, in full", P: "Yes, in part", N: "No" },
  D5: { TFER_REQ: "Required of All", TFER_REC: "Recommended of All", TFER_ROS: "Recommended of Some", TFER_RFS: "Required of Some", TFER_NREQ: "Not Required" },
  F3: { B: "On Campus", C: "At Cooperating Institution", MRN_OPT: "Marine Option (for Naval ROTC)" },
};

/**
 * H0's aid-year radio exports the start years of the two options it shows, "202 5 -202 6 Estimated or 202 4 -202 5
 * Final", one year behind (Howard's form: exports 2024 and 2023). The higher export is the edition's estimated year,
 * the lower the prior year's final figures. Any other shape is kept as exported (and fails `aid-year`).
 */
function aidYearWords(field: FormField, edition: string | null): string | null {
  const ed = parseEdition(edition);
  const years = field.exports.filter((e) => /^20\d{2}$/.test(e)).map(Number).sort((a, b) => b - a);
  if (!ed || years.length !== 2 || years[0] !== years[1] + 1 || !years.includes(Number(field.value))) return null;
  const range = (s: number) => `${s}-${s + 1}`;
  return Number(field.value) === years[0] ? `${range(ed.start)} Estimated` : `${range(ed.start - 1)} Final`;
}

/** The raw answer a field gives an item, before normalizing: radio codes as the template's words, checks as "X". */
export function formRaw(item: Pick<TemplateItem, "code" | "item" | "value_type">, field: FormField, edition: string | null): string | null {
  const v = field.value;
  if (v === null) return null;
  if (item.code === "H.101" && field.kind === "radio") return aidYearWords(field, edition) ?? v;
  if (field.kind === "radio") {
    if (/^n\/a$/i.test(v)) return null;
    // A radio standing for a checkbox ("Y" or "Other" on an open-admission line) is checked when anything is selected.
    if (item.value_type === "check") return "X";
    return RADIO_WORDS[item.item]?.[v] ?? v;
  }
  return v;
}

export interface FormRecordOptions {
  unit_id: string;
  url: string;
  sha256: string;
  retrieved: string;
  table: TemplateTable;
  /** The edition, when known; otherwise `coverLines` must state it. */
  edition?: string;
  /** The form's text layer as layout lines and their pages: the edition is read from its cover. */
  coverLines?: { lines: readonly string[]; pages: readonly number[] };
  final_url?: string;
}

/**
 * One record document from a fillable form, with no model call: every template code whose tag is a field of the form
 * is read from that field (`field` set to the field name, `page` to its page), normalized by its value type, and
 * type-checked; "question | value" quotes are kept for owned items. Codes without a tag (formula totals) or whose tag
 * isn't on the form are `not-read`; an empty field is `blank`; the respondent's identity is never kept.
 */
export function recordFromForm(widgets: readonly FormWidget[], opts: FormRecordOptions): DocumentRecord {
  const fields = formFields(widgets);
  const fromCover = opts.coverLines ? editionFromBody(opts.coverLines.lines, opts.coverLines.pages)?.edition : undefined;
  const edition = parseEdition(opts.edition ?? fromCover)?.key;
  if (!edition) throw new Error(`${opts.unit_id}: the form states no edition; pass one`);
  const aidField = opts.table.byCode.get("H.101")?.tag;
  const aidYear = aidField && fields.get(aidField) ? formRaw(opts.table.byCode.get("H.101")!, fields.get(aidField)!, edition) : null;
  const aidOk = parseAidYear(aidYear) !== null;
  const items: Record<CdsCode, ItemResult> = {};
  for (const it of opts.table.items) {
    const field = it.tag ? fields.get(it.tag.trim()) : undefined;
    if (RESPONDENT_CODES.has(it.code) || !field) {
      items[it.code] = { status: "not-read" };
      continue;
    }
    const raw = formRaw(it, field, edition);
    const n = normalizeValue(it, raw, { percentPoints: true }); // form fields hold printed numbers ("0.61" is 0.61%)
    if (n.status === "blank") {
      items[it.code] = { status: "blank" };
      continue;
    }
    const failures: ItemFailure[] = [];
    if (n.status === "overflow") failures.push({ check: "overflow-total", detail: `"${raw}" is an overflow mark` });
    const typeFail = n.status === "value" ? typeFailure(it, n.v) : null;
    if (typeFail) failures.push(typeFail);
    if (it.year_rule === "aid-year" && !aidOk) failures.push({ check: "aid-year", detail: `H.101 is ${aidYear === null ? "blank" : `"${aidYear}"`}, which names no aid year` });
    const r: ItemResult = { status: failures.length ? "failed" : "passed", page: field.page, field: field.name };
    if (n.v !== null) r.v = n.v;
    if (it.owner && raw !== null) r.quote = quoteOf(it.question.replace(/\s+/g, " ").trim(), raw);
    if (failures.length) r.failures = failures;
    items[it.code] = r;
  }
  return {
    sha256: opts.sha256,
    edition,
    type: "pdf-form",
    url: opts.url,
    ...(opts.final_url ? { final_url: opts.final_url } : {}),
    retrieved: opts.retrieved,
    reads: { deterministic: { schema_version: READER_VERSIONS["pdf-form"], read_by: "pdf-form", mode: "deterministic", extracted: opts.retrieved } },
    years: yearsForEdition(edition, { aidYear }),
    items,
  };
}

/** Reads a fillable form from its bytes: widgets, the cover's edition, then recordFromForm. */
export async function readFormPdf(bytes: Uint8Array, opts: Omit<FormRecordOptions, "coverLines">): Promise<DocumentRecord> {
  const widgets = await readFormWidgets(bytes);
  const coverLines = opts.edition ? undefined : linesFromItems(await pdfTextItems(bytes));
  return recordFromForm(widgets, { ...opts, ...(coverLines ? { coverLines } : {}) });
}
