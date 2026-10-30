/**
 * The hand-read form's state (specs/product/essays/sources.md "The hand read"; app/admin/essays/[unit]): what the
 * admin types, as plain strings and booleans, and the one function that turns it into a `ConfirmedRecord`. Pure and
 * client-safe: the form (components/admin/EssayPromptsForm.tsx) builds the record to show `validateConfirmed`'s
 * problems before any call, and the Server Action (lib/admin/essays-actions.ts) builds it again from the posted draft,
 * with the college's id and name from the dataset, never from the form.
 */
import type { EssayFormKind, EssayPrompt } from "../types.ts";
import { validateConfirmed, type ConfirmedRecord } from "../essay-prompts/confirmed.ts";

export type LimitKind = "words" | "characters" | "none";

export interface DraftRow {
  text: string;
  kind: EssayPrompt["kind"];
  limitKind: LimitKind;
  /** Typed numbers, kept as text so a half-typed field isn't lost. */
  max: string;
  min: string;
  required: boolean;
  appliesTo: "all" | "program";
  program: string;
}

export interface EssayDraft {
  cycle: string;
  form: EssayFormKind;
  readOn: string;
  reader: string;
  status: "published" | "none";
  rows: DraftRow[];
  /** "Choose n of these" over the unrequired rows. */
  choose: { on: boolean; n: string };
  note: string;
}

/** The five forms, in the order the form lists them. */
export const FORM_OPTIONS: readonly { value: EssayFormKind; label: string }[] = [
  { value: "common_app", label: "Common App" },
  { value: "coalition", label: "Coalition (Scoir)" },
  { value: "apply_texas", label: "ApplyTexas" },
  { value: "uc", label: "University of California" },
  { value: "own", label: "The college's own application" },
];

export const KIND_OPTIONS: readonly { value: EssayPrompt["kind"]; label: string }[] = [
  { value: "essay", label: "Essay" },
  { value: "short_answer", label: "Short answer" },
  { value: "why_us", label: "Why this college" },
  { value: "program", label: "Program" },
  { value: "activity", label: "Activity" },
  { value: "optional", label: "Optional" },
  { value: "other", label: "Other" },
];

export const LIMIT_OPTIONS: readonly { value: LimitKind; label: string }[] = [
  { value: "words", label: "Words" },
  { value: "characters", label: "Characters" },
  { value: "none", label: "No limit" },
];

export const formLabel = (form: EssayFormKind) => FORM_OPTIONS.find((f) => f.value === form)?.label ?? form;

export function emptyRow(text = ""): DraftRow {
  return { text, kind: "short_answer", limitKind: "words", max: "", min: "", required: true, appliesTo: "all", program: "" };
}

/** A new draft: the open cycle, the form the college is on, today, nothing read yet. */
export function emptyDraft(defaults: { cycle: string; form: EssayFormKind; today: string }): EssayDraft {
  return { cycle: defaults.cycle, form: defaults.form, readOn: defaults.today, reader: "", status: "published", rows: [emptyRow()], choose: { on: false, n: "1" }, note: "" };
}

/** A saved record as the form's draft (to edit it). */
export function draftFromRecord(r: ConfirmedRecord): EssayDraft {
  return {
    cycle: r.cycle,
    form: r.form,
    readOn: r.read_on,
    reader: r.reader,
    status: r.status,
    rows: r.prompts.map((p) => ({
      text: p.text,
      kind: p.kind,
      limitKind: p.limit?.kind ?? "none",
      max: p.limit ? String(p.limit.max) : "",
      min: p.limit?.min !== undefined ? String(p.limit.min) : "",
      required: p.required,
      appliesTo: typeof p.applies_to === "object" ? "program" : "all",
      program: typeof p.applies_to === "object" ? p.applies_to.program : "",
    })),
    choose: r.choose ? { on: true, n: String(r.choose.n) } : { on: false, n: "1" },
    note: r.note ?? "",
  };
}

const num = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : Number.NaN);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The words a hand-read choice group carries (the form shows the group, not a sentence to quote). */
export function chooseQuote(n: number, of: number): string {
  return `Choose ${n} of these ${of}.`;
}

/**
 * The draft as a record: ids `{unit}:{cycle}:{n}` in the form's order, each quote the question's own text, the
 * choice group over the unrequired rows. No checks here: `validateConfirmed` says what is wrong.
 */
export function recordFromDraft(d: EssayDraft, college: { unit_id: string; name: string }): ConfirmedRecord {
  const published = d.status === "published";
  const rows = published ? d.rows : [];
  const prompts: EssayPrompt[] = rows.map((row, i) => {
    const text = oneLine(row.text);
    const max = num(row.max);
    const min = num(row.min);
    const limit = row.limitKind === "none" ? null : { kind: row.limitKind, max, ...(row.min.trim() ? { min } : {}) };
    return {
      id: `${college.unit_id}:${d.cycle}:${i + 1}`,
      text,
      kind: row.kind,
      limit,
      required: row.required,
      applies_to: row.appliesTo === "program" ? { program: oneLine(row.program) } : "all",
      quote: text,
    };
  });
  const of = prompts.filter((p) => !p.required).length;
  const n = num(d.choose.n);
  const note = d.note.trim();
  return {
    unit_id: college.unit_id,
    name: college.name,
    cycle: d.cycle.trim(),
    status: d.status,
    confidence: "confirmed",
    source: "form-by-hand",
    form: d.form,
    read_on: d.readOn.trim(),
    reader: d.reader.trim().toUpperCase(),
    prompts,
    ...(published && d.choose.on ? { choose: { n, of, quote: chooseQuote(n, of) } } : {}),
    ...(note ? { note } : {}),
  };
}

const KINDS = new Set(KIND_OPTIONS.map((k) => k.value));
const FORMS = new Set(FORM_OPTIONS.map((f) => f.value));
const LIMITS = new Set(LIMIT_OPTIONS.map((l) => l.value));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * A posted draft (JSON from the form) checked for shape: every field the right type, unknown values refused, text cut
 * to size. Null when it isn't a draft at all. The values are still checked by `validateConfirmed` afterwards.
 */
export function parseDraft(raw: unknown): EssayDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.rows) || d.rows.length > 40) return null;
  if (!FORMS.has(d.form as EssayFormKind)) return null;
  if (d.status !== "published" && d.status !== "none") return null;
  const rows: DraftRow[] = [];
  for (const r of d.rows as unknown[]) {
    if (!r || typeof r !== "object") return null;
    const row = r as Record<string, unknown>;
    if (!KINDS.has(row.kind as EssayPrompt["kind"]) || !LIMITS.has(row.limitKind as LimitKind)) return null;
    if (typeof row.required !== "boolean" || (row.appliesTo !== "all" && row.appliesTo !== "program")) return null;
    rows.push({
      text: str(row.text, 3000),
      kind: row.kind as EssayPrompt["kind"],
      limitKind: row.limitKind as LimitKind,
      max: str(row.max, 8),
      min: str(row.min, 8),
      required: row.required,
      appliesTo: row.appliesTo,
      program: str(row.program, 200),
    });
  }
  const choose = (d.choose ?? {}) as Record<string, unknown>;
  return {
    cycle: str(d.cycle, 10),
    form: d.form as EssayFormKind,
    readOn: str(d.readOn, 10),
    reader: str(d.reader, 4),
    status: d.status,
    rows,
    choose: { on: choose.on === true, n: str(choose.n, 4) },
    note: str(d.note, 2000),
  };
}

/**
 * Everything wrong with the draft, in plain words: blanks the record can't show (a limit with no maximum, a choice
 * group with no number) first, then `validateConfirmed`'s problems on the record it builds.
 */
export function draftProblems(d: EssayDraft, college: { unit_id: string; name: string }, ctx: { openCycle?: string; today?: string } = {}): string[] {
  const out: string[] = [];
  // The advisor and the nightly merge read only the open cycle's record (hand-read-brief.md "Precedence").
  if (ctx.openCycle && d.cycle.trim() !== ctx.openCycle) out.push(`the cycle must be the open one, ${ctx.openCycle}`);
  if (ctx.today && /^\d{4}-\d{2}-\d{2}$/.test(d.readOn.trim()) && d.readOn.trim() > ctx.today) out.push("the read-on date can't be after today");
  const blanks = new Set<number>();
  if (d.status === "published") {
    d.rows.forEach((row, i) => {
      if (row.limitKind !== "none" && !row.max.trim()) {
        out.push(`prompt ${i + 1}: enter the limit's maximum, or choose No limit`);
        blanks.add(i + 1);
      } else if (row.limitKind !== "none" && (Number.isNaN(num(row.max)) || (row.min.trim() && Number.isNaN(num(row.min))))) {
        out.push(`prompt ${i + 1}: the limit must be a whole number`);
        blanks.add(i + 1);
      }
    });
    if (d.choose.on && Number.isNaN(num(d.choose.n))) out.push("choose: enter how many to answer");
  }
  const rest = validateConfirmed(recordFromDraft(d, college)).filter((p) => {
    const m = /^prompt (\d+): (a limit|the minimum)/.exec(p);
    return !(m && blanks.has(Number(m[1]))) && !(p.startsWith("choose: how many") && out.includes("choose: enter how many to answer"));
  });
  return [...out, ...rest];
}

/** Which rows a problem list names ("prompt 3: …" → row index 2), to mark them in the form. */
export function rowsWithProblems(problems: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const p of problems) {
    const m = /^prompt (\d+):/.exec(p);
    if (m) out.add(Number(m[1]) - 1);
  }
  return out;
}
