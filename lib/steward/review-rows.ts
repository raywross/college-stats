/**
 * The college Review page's rows (`/admin/colleges/[unit]/review`; specs/product/data-steward.md "The college's Review
 * page"): everything pending for one school, one row per field or code, grouped by code. Each open review item is a
 * row with what the site shows now (from the same `citeField` the profile uses, or the college's own CDS record for a
 * code no registered field reaches), the document it came from at the page and line, its issues (each with the
 * cluster key the Issues screen uses), and the existing Accept plan (`acceptPlan`, lib/admin/review-queue.ts). A row
 * of a pending Steward proposal adds what is proposed, its recommendation and the proposal it belongs to; a proposal
 * row with no open item is a row of its own. Before any Steward run, the page is the open items alone.
 *
 * `reviewColleges` is the Issues screen's "Colleges to review": colleges with pending rows, ordered by how many
 * visible figures would change, then by "your call" rows. Pure.
 */
import { acceptPlan, C1_TOTALS, type AcceptPlan } from "../admin/review-queue.ts";
import { compareCodes, itemOfCode, type CollegeRecord, type TemplateTable } from "../cds-sections.ts";
import { FIELDS, isFieldPath, type FieldPath } from "../fields.ts";
import type { Cited } from "../lineage.ts";
import { reviewKey, type ReviewItem } from "../reported.ts";
import type { School } from "../types.ts";
import { failureClusterKey, freeDetailChecks } from "./cluster.ts";
import type { ProposalDoc, ProposalKind, ProposalRow, ProposalStatus, Recommendation, RowDecision } from "./types.ts";

/** Proposals whose rows are still pending (shown on the Review page): not declined, not yet applied. */
export const PENDING_PROPOSAL_STATUSES: ReadonlySet<ProposalStatus> = new Set(["open", "asked", "approved"]);
/** Proposal kinds whose rows change a value a visitor sees. */
export const VISIBLE_KINDS: ReadonlySet<ProposalKind> = new Set(["correct", "publish", "hold", "refile", "systemic"]);

export interface ReviewRowSource {
  /** The document as the item names it (its URL), or null. */
  document: string | null;
  /** Where to open it: the final URL when known. */
  url: string | null;
  page: number | null;
  line: number | null;
  /** A workbook's cell ("CDS-C!AC5"), when the value came from one. */
  cell: string | null;
  quote: string | null;
}

export interface ReviewIssue {
  check: string;
  detail: string;
  /** The Issues screen's cluster key for this failure. */
  cluster: string;
}

export interface ReviewRow {
  /** The queue item's key (`unit|edition|code`), or `<proposal key>#<row index>` for a proposal row with no open item. */
  id: string;
  unit_id: string;
  code: string | null;
  /** The registered field the value reaches, when one does. */
  field: FieldPath | null;
  /** "Applicants (C1)", "C7 · C.701". */
  label: string;
  /** The template's question for the code, when the template is given. */
  question: string | null;
  edition: string | null;
  /** What a visitor sees now, with its source and year: "1,234 · IPEDS, Fall 2024"; "Not shown" when nothing is. */
  now: string;
  /** What is proposed, in words (a proposal row), or null. */
  proposed: string | null;
  /** The value as read (an item) or proposed (a proposal row). */
  value: number | string | boolean | null;
  from: ReviewRowSource | null;
  issues: ReviewIssue[];
  recommends: Recommendation | null;
  why: string | null;
  proposal: { key: string; kind: ProposalKind; status: ProposalStatus; row: number } | null;
  decision: RowDecision | null;
  /** The open item the row settles, or null. */
  item: ReviewItem | null;
  /** Whether Accept the value is offered for the item (the existing plan), or null for a proposal-only row. */
  accept: AcceptPlan | null;
}

export interface ReviewGroup {
  /** The code ("C.701"), or the field path for a field-only proposal row. */
  code: string;
  /** The CDS item ("C7"), or the field's label. */
  label: string;
  rows: ReviewRow[];
}

export interface ReviewInputs {
  /** Review-queue items (the college's; others are ignored). Resolved items count only as a C1 total's siblings. */
  items: readonly ReviewItem[];
  /** The college's `reported.cds_records` document, or null. */
  record: CollegeRecord | null;
  /** Steward proposals (any college's; rows of other colleges are ignored). */
  proposals: readonly ProposalDoc[];
  /** The dataset's citation (lib/dataset.ts `citeField`). */
  citeField: (path: FieldPath, school?: School) => Cited;
  /** The college as the site shows it (the dataset's school), for the value at a path. */
  school?: School | null;
  /** The whole queue's free-detail checks (lib/steward/cluster.ts), so cluster keys match the Issues screen. */
  free?: ReadonlySet<string>;
  /** The CDS template table, for each code's question. */
  template?: TemplateTable | null;
}

/** The value at a dotted path, or undefined. */
function valueAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const SHARE_PATH = /(rate|share|_pct|percent)(_|$)/;

/** A value in words: numbers with separators, a share as a percent, Yes/No, text as text. */
export function valueWords(v: unknown, path?: string | null): string {
  if (v === null || v === undefined || v === "") return "None";
  if (typeof v === "number") {
    if (path && SHARE_PATH.test(path) && v >= 0 && v <= 1) return `${Number((v * 100).toFixed(1)).toLocaleString("en-US")}%`;
    return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  const s = JSON.stringify(v) ?? "";
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/** The citation in a few words: "IPEDS, Fall 2024", "Edited by Quad". */
export function citeWords(c: Pick<Cited, "key" | "label" | "year" | "cdsEdition">): string {
  if (c.key === "quad-edit") return "Edited by Quad";
  if (c.cdsEdition) return `${c.label}, CDS ${c.cdsEdition}`;
  return c.year ? `${c.label}, ${c.year}` : c.label;
}

/** What a visitor sees at a field now: the value and its citation, or "Not shown". */
export function nowAtField(path: FieldPath, school: School | null | undefined, citeField: ReviewInputs["citeField"]): string {
  const v = school ? valueAt(school, path) : undefined;
  if (v === null || v === undefined) return "Not shown";
  return `${valueWords(v, path)} · ${citeWords(citeField(path, school ?? undefined))}`;
}

/** What a visitor sees for a code no field reaches: the newest passed value in the college's CDS record, or "Not shown". */
export function nowAtCode(code: string, record: CollegeRecord | null): string {
  for (const doc of record?.documents ?? []) {
    const it = doc.items[code];
    if (it?.status === "passed") return `${valueWords(it.v ?? null)} · CDS ${doc.edition}`;
  }
  return "Not shown";
}

/** The registered field an item's value reaches, when Accept would write one (a C1 total; a submission share). */
function fieldOfItem(item: ReviewItem, plan: AcceptPlan): FieldPath | null {
  if (!plan.ok) return null;
  const name = item.code ? C1_TOTALS[item.code as keyof typeof C1_TOTALS] : undefined;
  const path = name ? `admissions.${name}` : (Object.keys(plan.values).find((p) => p !== "admissions.year") ?? null);
  return path && isFieldPath(path) ? path : null;
}

function fieldLabel(path: FieldPath): string {
  return (FIELDS[path] as { label?: string } | undefined)?.label ?? path;
}

function labelOf(code: string | null, field: FieldPath | null): string {
  if (field) return code ? `${fieldLabel(field)} (${itemOfCode(code)})` : fieldLabel(field);
  if (code) return `${itemOfCode(code)} · ${code}`;
  return "C1 (whole document)";
}

function sourceOfItem(item: ReviewItem, record: CollegeRecord | null): ReviewRowSource {
  const doc = record?.documents.find((d) => (item.sha256 ? d.sha256 === item.sha256 : d.edition === item.edition));
  const it = item.code ? doc?.items[item.code] : undefined;
  return {
    document: item.urls[0] ?? doc?.url ?? null,
    url: doc?.final_url ?? doc?.url ?? item.urls[0] ?? null,
    page: it?.page ?? null,
    line: it?.line ?? it?.lines?.[0] ?? null,
    cell: it?.cell ?? null,
    quote: it?.quote ?? null,
  };
}

const sourceOfRow = (r: ProposalRow, fallback: ReviewRowSource | null): ReviewRowSource => ({
  document: fallback?.document ?? r.source.url,
  url: r.source.url ?? fallback?.url ?? null,
  page: r.source.page,
  line: r.source.line,
  cell: fallback?.cell ?? null,
  quote: r.source.quote,
});

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The pending proposal rows of one college, with their proposal and index, newest proposal first. */
function pendingRows(unit: string, proposals: readonly ProposalDoc[]): { proposal: ProposalDoc; row: ProposalRow; index: number }[] {
  return [...proposals]
    .filter((p) => PENDING_PROPOSAL_STATUSES.has(p.status))
    .sort((a, b) => byText(b.created, a.created) || byText(a.key, b.key))
    .flatMap((proposal) => proposal.rows.map((row, index) => ({ proposal, row, index })).filter((x) => x.row.unit_id === unit));
}

/** One college's Review rows, grouped by code (template order), field-only groups after. */
export function reviewRows(unit: string, inputs: ReviewInputs): ReviewGroup[] {
  const mine = inputs.items.filter((i) => i.unit_id === unit);
  const open = mine.filter((i) => !i.resolved).sort((a, b) => byText(reviewKey(a), reviewKey(b)));
  const free = inputs.free ?? freeDetailChecks(inputs.items);
  const rows = new Map<string, ReviewRow>();

  for (const item of open) {
    const id = reviewKey(item);
    const plan = acceptPlan(item, mine);
    const field = fieldOfItem(item, plan);
    const code = item.code ?? null;
    rows.set(id, {
      id,
      unit_id: unit,
      code,
      field,
      label: labelOf(code, field),
      question: code ? (inputs.template?.byCode.get(code)?.question ?? null) : null,
      edition: item.edition ?? null,
      now: field ? nowAtField(field, inputs.school, inputs.citeField) : code ? nowAtCode(code, inputs.record) : "Not shown",
      proposed: null,
      value: item.value ?? null,
      from: sourceOfItem(item, inputs.record),
      issues: item.failures.map((f) => ({ check: f.check, detail: f.detail, cluster: failureClusterKey(f, free) })),
      recommends: null,
      why: null,
      proposal: null,
      decision: null,
      item,
      accept: plan,
    });
  }

  for (const { proposal, row, index } of pendingRows(unit, inputs.proposals)) {
    const ref = { key: proposal.key, kind: proposal.kind, status: proposal.status, row: index };
    const attached = row.item ? rows.get(row.item) : undefined;
    if (attached && !attached.proposal) {
      rows.set(attached.id, {
        ...attached,
        proposed: row.proposed,
        value: row.value ?? attached.value,
        from: sourceOfRow(row, attached.from),
        recommends: row.recommends,
        why: row.why ?? null,
        proposal: ref,
        decision: row.decision ?? null,
      });
      continue;
    }
    const field = row.field && isFieldPath(row.field) ? row.field : null;
    const code = row.code ?? null;
    const id = `${proposal.key}#${index}`;
    rows.set(id, {
      id,
      unit_id: unit,
      code,
      field,
      label: labelOf(code, field),
      question: code ? (inputs.template?.byCode.get(code)?.question ?? null) : null,
      edition: row.edition,
      // What the site shows is read now (the proposal's `now` was true when it was written), from the same reader the profile uses.
      now: field ? nowAtField(field, inputs.school, inputs.citeField) : code ? nowAtCode(code, inputs.record) : row.now || "Not shown",
      proposed: row.proposed,
      value: row.value ?? null,
      from: sourceOfRow(row, null),
      issues: [],
      recommends: row.recommends,
      why: row.why ?? null,
      proposal: ref,
      decision: row.decision ?? null,
      item: null,
      accept: null,
    });
  }

  const groups = new Map<string, ReviewGroup>();
  for (const r of rows.values()) {
    const code = r.code ?? r.field ?? "C1";
    let g = groups.get(code);
    if (!g) groups.set(code, (g = { code, label: r.code ? itemOfCode(r.code) : r.field ? fieldLabel(r.field) : "C1", rows: [] }));
    g.rows.push(r);
  }
  const isCode = (s: string) => /^[A-J]\./.test(s);
  return [...groups.values()]
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => byText(a.id, b.id)) }))
    .sort((a, b) => {
      if (isCode(a.code) && isCode(b.code)) return compareCodes(a.code, b.code);
      if (isCode(a.code) !== isCode(b.code)) return isCode(a.code) ? -1 : 1;
      return byText(a.label, b.label);
    });
}

export interface CollegeToReview {
  unit_id: string;
  name: string;
  /** Open review items. */
  items: number;
  /** Pending, undecided proposal rows. */
  rows: number;
  /** Of those, rows that would change a value a visitor sees. */
  changes: number;
  /** Of those, rows the Steward marked "your call". */
  yourCall: number;
}

/** Colleges with pending rows: most visible changes first, then "your call" rows, then open items, then name. */
export function reviewColleges(items: readonly ReviewItem[], proposals: readonly ProposalDoc[], names?: ReadonlyMap<string, string>): CollegeToReview[] {
  const out = new Map<string, CollegeToReview>();
  const get = (unit: string, name?: string) => {
    let c = out.get(unit);
    if (!c) out.set(unit, (c = { unit_id: unit, name: names?.get(unit) ?? name ?? unit, items: 0, rows: 0, changes: 0, yourCall: 0 }));
    return c;
  };
  for (const item of items) if (!item.resolved) get(item.unit_id, item.name).items++;
  for (const p of proposals) {
    if (!PENDING_PROPOSAL_STATUSES.has(p.status) || p.status === "approved") continue;
    for (const r of p.rows) {
      if (r.decision) continue;
      const c = get(r.unit_id);
      c.rows++;
      if (VISIBLE_KINDS.has(p.kind)) c.changes++;
      if (r.recommends === "your-call") c.yourCall++;
    }
  }
  return [...out.values()].sort((a, b) => b.changes - a.changes || b.yourCall - a.yourCall || b.items - a.items || a.name.localeCompare(b.name, "en") || byText(a.unit_id, b.unit_id));
}
