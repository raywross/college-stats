/**
 * The Steward's tools (the build brief's "Tools" contract; names fixed so a dry run's recorded answers call them):
 * read tools over the store, the archive, the documents and the bundled snapshot, and write tools over the writer
 * (./writer.mts), which puts every document in the run's change set. Each tool is a plain async function over a
 * `StewardContext`, so the tests call them directly; `stewardTools(ctx, mode)` wraps them as `betaZodTool`s for the
 * SDK's tool runner (`client.beta.messages.toolRunner`), each answering with compact JSON.
 *
 * `read_document_lines` with a `question` fans the lines out to Sonnet 5 (with a `line`, a window of lines to Haiku
 * 4.5), so the main context holds a short finding rather than a document; each sub-read is charged to the budget and
 * checked before it is made.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { DatasetMeta, School } from "../../../lib/types";
import type { CollegeRecord, ItemResult, ManifestEntry } from "../../../lib/cds-sections.ts";
import { isFieldPath, type FieldPath } from "../../../lib/fields.ts";
import { citationText, lineageFor } from "../../../lib/lineage.ts";
import { reviewKey, type ReviewItem } from "../../../lib/reported.ts";
import type { Cluster, IssueDoc, ProposalRow, TodoDoc } from "../../../lib/steward/types.ts";
import { COLLECTIONS } from "../data-platform/layers.mts";
import type { DataStore } from "../data-platform/store.mts";
import { readBundledColleges, readBundledMeta } from "../data-platform/bundled.mts";
import { clusterItems, clusterQueue } from "../../../lib/steward/cluster.ts";
import { kindsOf } from "../../../lib/steward/kinds.ts";
import { Budget, tokensOf } from "./budget.mts";
import { documentLines, lineWindow, numberedText, type DocumentDeps } from "./documents.mts";
import { LINE_MAX_TOKENS, READ_MAX_TOKENS, STEWARD_MODELS, type StewardModel } from "./models.mts";
import { linePrompt, READ_SCHEMA, readPrompt } from "./prompts.mts";
import { StewardWriter } from "./writer.mts";

/** What the site shows for one college, from the bundled snapshot (lazily read). */
export interface SiteReader {
  school(unitId: string): School | null;
  meta(): DatasetMeta;
}

/** The bundled snapshot (`.data/snapshot/`, what `npm run fetch-snapshot` wrote) as a `SiteReader`. */
export function bundledSite(dir?: string): SiteReader {
  let byId: Map<string, School> | null = null;
  let meta: DatasetMeta | null = null;
  return {
    school(unitId) {
      byId ??= new Map(readBundledColleges(dir).map((s) => [s.unit_id, s]));
      return byId.get(unitId) ?? null;
    },
    meta() {
      return (meta ??= readBundledMeta(dir));
    },
  };
}

export interface StewardContext {
  store: DataStore;
  /** Null in apply mode (no model, no Steward documents but the proposal's status). */
  writer: StewardWriter | null;
  docs: DocumentDeps;
  site: SiteReader;
  /** The client for sub-reads (the real one, or the dry run's); null when the run makes no model call. */
  client: Anthropic | null;
  budget: Budget;
  now: () => Date;
  run: string;
  log: (line: string) => void;
  /** Where the run is, for the run record when it stops early. */
  progress: { cluster: string | null; tool: string | null; calls: number };
  cache: { queue?: Map<string, ReviewItem>; clusters?: Cluster[]; manifest?: Map<string, ManifestEntry>; records: Map<string, CollegeRecord | null> };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The open queue items by key (resolved ones are left out), read once per run. */
export async function openQueue(ctx: StewardContext): Promise<Map<string, ReviewItem>> {
  if (!ctx.cache.queue) {
    const all = await ctx.store.read<ReviewItem>(COLLECTIONS.reported.reviewQueue);
    ctx.cache.queue = new Map([...all].filter(([, i]) => !i.resolved));
  }
  return ctx.cache.queue;
}

export async function clusters(ctx: StewardContext): Promise<Cluster[]> {
  return (ctx.cache.clusters ??= clusterQueue([...(await openQueue(ctx)).values()]));
}

/** The `reported.docs` manifest by sha256, read once per run. */
export async function manifest(ctx: Pick<StewardContext, "store" | "cache">): Promise<Map<string, ManifestEntry>> {
  return (ctx.cache.manifest ??= await ctx.store.read<ManifestEntry>(COLLECTIONS.reported.docs));
}

/** `DocumentDeps` over the store's manifest, an archive, and a polite GET. */
export function documentDeps(ctx: Pick<StewardContext, "store" | "cache">, archive: DocumentDeps["archive"], fetchBytes: DocumentDeps["fetchBytes"]): DocumentDeps {
  return {
    archive,
    fetchBytes,
    manifest: async (sha) => (await manifest(ctx)).get(sha) ?? null,
    manifestByUrl: async (url) => [...(await manifest(ctx)).values()].find((e) => e.url === url || e.final_url === url) ?? null,
  };
}

async function record(ctx: StewardContext, unitId: string): Promise<CollegeRecord | null> {
  if (!ctx.cache.records.has(unitId)) ctx.cache.records.set(unitId, await ctx.store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, unitId));
  return ctx.cache.records.get(unitId) ?? null;
}

/** An item as the tools show it: where it is in the document and why it is held. */
const itemView = (code: string, it: ItemResult) => ({
  code,
  v: it.v,
  status: it.status,
  ...(it.page !== undefined ? { page: it.page } : {}),
  ...(it.line !== undefined ? { line: it.line } : {}),
  ...(it.cell ? { cell: it.cell } : {}),
  ...(it.quote ? { quote: it.quote } : {}),
  ...(it.failures?.length ? { failures: it.failures } : {}),
  ...(it.column ? { column: it.column } : {}),
});

export async function listClusters(ctx: StewardContext, input: { limit?: number; check?: string }) {
  const all = await clusters(ctx);
  const issues = await ctx.store.read<IssueDoc>(COLLECTIONS.steward.issues);
  const shown = all.filter((c) => !input.check || c.check === input.check).slice(0, input.limit ?? 25);
  // The kind lib/steward/kinds.ts gives each cluster by rule (the Issues screen shows the same): a starting point.
  const docs = await manifest(ctx);
  const kinds = kindsOf(shown, [...(await openQueue(ctx)).values()], { fetched: (sha) => docs.has(sha) });
  return {
    open_items: (await openQueue(ctx)).size,
    clusters: all.length,
    shown: shown.map((c) => {
      const issue = issues.get(c.key);
      return { ...c, documents: c.documents.length, kind_by_rule: kinds.get(c.key), ...(issue ? { issue: { kind: issue.kind, status: issue.status, run: issue.run, reason: issue.reason } } : {}) };
    }),
  };
}

export async function readCluster(ctx: StewardContext, input: { key: string; limit?: number }) {
  const c = (await clusters(ctx)).find((x) => x.key === input.key);
  if (!c) throw new Error(`no cluster "${input.key}"; list_clusters gives the keys`);
  ctx.progress.cluster = c.key;
  const check = c.check;
  const members = clusterItems([...(await openQueue(ctx)).values()], c.key).map((i) => [reviewKey(i), i] as const);
  // A spread across colleges: one item per college first, then the rest, in key order.
  const seen = new Set<string>();
  const first = members.filter(([, i]) => !seen.has(i.unit_id) && seen.add(i.unit_id));
  const ordered = [...first, ...members.filter((m) => !first.includes(m))].slice(0, input.limit ?? 20);
  const items = [];
  for (const [key, i] of ordered) {
    const rec = i.code && i.edition ? await record(ctx, i.unit_id) : null;
    const doc = rec?.documents.find((d) => d.edition === i.edition);
    const it = doc && i.code ? doc.items[i.code] : undefined;
    items.push({
      key,
      unit_id: i.unit_id,
      name: i.name,
      edition: i.edition ?? null,
      code: i.code ?? null,
      value: i.value ?? null,
      sha256: i.sha256 ?? null,
      url: i.urls[0] ?? null,
      failures: i.failures.filter((f) => f.check === check),
      record_item: it ? itemView(i.code!, it) : null,
    });
  }
  const docs = await manifest(ctx);
  return {
    cluster: c,
    items,
    documents: c.documents.map((sha) => {
      const e = docs.get(sha);
      return e ? { sha256: sha, unit_id: e.unit_id, type: e.type, edition: e.edition, edition_from: e.edition_from ?? null, pages: e.pages ?? null, archived: e.archive } : { sha256: sha, manifest: null };
    }),
  };
}

export async function readRecord(ctx: StewardContext, input: { unit_id: string; edition: string; codes?: string[] }) {
  const rec = await record(ctx, input.unit_id);
  if (!rec) return { unit_id: input.unit_id, record: null, note: "no CDS record for this college" };
  const doc = rec.documents.find((d) => d.edition === input.edition);
  if (!doc) return { unit_id: input.unit_id, editions: rec.documents.map((d) => d.edition), note: `no ${input.edition} document` };
  const wanted = input.codes?.length ? input.codes : Object.keys(doc.items).filter((c) => doc.items[c].status === "failed");
  const items = wanted.filter((c) => doc.items[c]).slice(0, 120).map((c) => itemView(c, doc.items[c]));
  const counts: Record<string, number> = {};
  for (const it of Object.values(doc.items)) counts[it.status] = (counts[it.status] ?? 0) + 1;
  return { unit_id: rec.unit_id, edition: doc.edition, sha256: doc.sha256, type: doc.type, url: doc.final_url ?? doc.url, years: doc.years, counts, items, ...(wanted.length > 120 ? { note: `${wanted.length - 120} more; ask for codes` } : {}) };
}

/** The structured answer of a sub-read. */
export interface SubRead {
  answer: string;
  page: number | null;
  line: number | null;
  quote: string | null;
  confident: boolean;
}

/** One sub-read call: budget checked first, charged after. */
export async function subRead(ctx: StewardContext, model: StewardModel, prompt: string, maxTokens: number, purpose: string): Promise<SubRead> {
  if (!ctx.client) throw new Error("no model client in this mode");
  ctx.budget.ensure(model, tokensOf(prompt), Math.round(maxTokens / 2), purpose);
  const format = { type: "json_schema" as const, schema: READ_SCHEMA as unknown as Record<string, unknown> };
  // Sonnet 5 thinks adaptively at a low effort; Haiku 4.5 takes neither thinking nor effort (it says what a line says).
  const sonnet = model === STEWARD_MODELS.read;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
    ...(sonnet ? { thinking: { type: "adaptive" as const } } : {}),
    output_config: sonnet ? { effort: "low", format } : { format },
  };
  const msg = await ctx.client.messages.create(params);
  ctx.budget.charge(msg.usage, model, purpose);
  ctx.progress.calls++;
  if (msg.stop_reason === "refusal") return { answer: "the reader declined this request", page: null, line: null, quote: null, confident: false };
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return JSON.parse(text) as SubRead;
  } catch {
    return { answer: text.slice(0, 500) || "no answer", page: null, line: null, quote: null, confident: false };
  }
}

export async function readDocumentLines(ctx: StewardContext, input: { sha256?: string; url?: string; pages?: number[]; question?: string; line?: number }) {
  const got = await documentLines(ctx.docs, { sha256: input.sha256 ?? null, url: input.url ?? null });
  if ("unavailable" in got) return got;
  const head = { sha256: got.sha256, url: got.url, type: got.type, edition: got.edition, lines: got.lines.length, pages: got.pages.length ? Math.max(...got.pages) : 0, from: got.from };
  if (input.line !== undefined) {
    if (input.line < 1 || input.line > got.lines.length) return { ...head, error: `line ${input.line} is outside 1–${got.lines.length}` };
    const window = lineWindow(got, input.line);
    if (!input.question) return { ...head, text: window };
    return { ...head, read_by: STEWARD_MODELS.line, ...(await subRead(ctx, STEWARD_MODELS.line, linePrompt(input.line, input.question, window), LINE_MAX_TOKENS, `line ${input.line} of ${got.sha256.slice(0, 10)}`)) };
  }
  const { text, truncatedAt } = numberedText(got, input.pages);
  if (!input.question) return { ...head, truncated_at_page: truncatedAt, text };
  return { ...head, read_by: STEWARD_MODELS.read, ...(await subRead(ctx, STEWARD_MODELS.read, readPrompt(input.question, text), READ_MAX_TOKENS, `question on ${got.sha256.slice(0, 10)}`)) };
}

const valueAt = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

/** What the site shows for a registered field, with its source and year from the same lineage the profile cites. */
export function readSiteValue(ctx: Pick<StewardContext, "site">, input: { unit_id: string; field: string }) {
  const school = ctx.site.school(input.unit_id);
  if (!school) return { unit_id: input.unit_id, field: input.field, shows: "Not shown", note: "the college isn't in the published dataset" };
  if (!isFieldPath(input.field)) return { unit_id: input.unit_id, name: school.name, field: input.field, shows: "Not shown", note: "not a registered field: this CDS item is kept only in the college's record and isn't published as a field" };
  const value = valueAt(school, input.field);
  const cite = lineageFor(input.field as FieldPath, school, ctx.site.meta());
  const shown = value === undefined || value === null ? "Not shown" : `${typeof value === "object" ? JSON.stringify(value) : String(value)} · ${citationText(cite)}`;
  return { unit_id: input.unit_id, name: school.name, field: input.field, label: cite.field, value: value ?? null, source: citationText(cite), shows: shown };
}

export async function readFailures(ctx: StewardContext, input: { unit_id: string }) {
  const failures = await ctx.store.readOne<unknown>(COLLECTIONS.reported.failures, input.unit_id);
  const todo = [...(await ctx.store.read<TodoDoc>(COLLECTIONS.steward.todo)).values()].filter((t) => t.unit_id === input.unit_id);
  const recipe = await ctx.store.readOne<unknown>(COLLECTIONS.reported.sources, input.unit_id);
  return { unit_id: input.unit_id, failures: failures ?? [], recipe, todo };
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const nullableString = z.string().nullable();
const nullableInt = z.number().int().nullable();

export const FindingSchema = z.object({
  unit_id: z.string(),
  edition: nullableString,
  sha256: nullableString,
  url: nullableString,
  page: nullableInt,
  line: nullableInt,
  shows: z.string().describe("What the document shows there, quoted or in a few words."),
});

export const RowSchema = z.object({
  unit_id: z.string(),
  field: nullableString.describe("A registered field path (correct, publish); sources.add | sources.drop | rediscover (recipe); else null."),
  code: nullableString.describe("The CDS code (C.802) for hold, reject; else null."),
  edition: nullableString,
  sha256: nullableString,
  now: z.string().describe("What a visitor sees now, from read_site_value ('72.1% · IPEDS Admissions, Fall 2023'), or 'Not shown'."),
  proposed: z.string().describe("What is proposed, in words."),
  value: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional().describe("The value to write (correct, publish), or the URL (recipe)."),
  source: z.object({ page: nullableInt, line: nullableInt, quote: nullableString, url: nullableString }),
  recommends: z.enum(["approve", "your-call"]),
  why: z.string().optional().describe("Why 'your-call', when it is."),
  item: nullableString.describe("The review queue key this row settles (unit|edition|code), or null."),
});

const KIND = z.enum(["value", "systemic", "acquisition", "policy"]);
const PROPOSAL_KIND = z.enum(["correct", "publish", "hold", "refile", "reject", "recipe", "reread", "systemic"]);
const TODO_WHY = z.enum(["robots-path", "robots-host", "challenge", "bot-check", "viewer", "js-only", "terms", "login", "not-found", "no-document", "unknown"]);

export const SCHEMAS = {
  list_clusters: z.object({ limit: z.number().int().min(1).max(100).optional(), check: z.string().optional().describe("Only this check's clusters.") }),
  read_cluster: z.object({ key: z.string().describe("The cluster key from list_clusters."), limit: z.number().int().min(1).max(60).optional() }),
  read_record: z.object({ unit_id: z.string(), edition: z.string(), codes: z.array(z.string()).optional().describe("Codes to show; default the held ones.") }),
  read_document_lines: z.object({
    sha256: z.string().optional(),
    url: z.string().optional(),
    pages: z.array(z.number().int().min(1)).optional().describe("Pages to read; default all (long documents are cut, ask for later pages)."),
    question: z.string().optional().describe("Ask a cheaper reader this question about the lines instead of reading them yourself; it answers with page, line and quote."),
    line: z.number().int().min(1).optional().describe("A line to read with the headings above it (with a question, a small reader answers it)."),
  }),
  read_site_value: z.object({ unit_id: z.string(), field: z.string().describe("A registered field path, e.g. admissions.acceptance_rate.") }),
  read_failures: z.object({ unit_id: z.string() }),
  write_issue: z.object({
    key: z.string().describe("The cluster key."),
    kind: KIND,
    hypothesis: z.string(),
    findings: z.array(FindingSchema),
    status: z.enum(["new", "investigating", "proposed", "waiting"]).optional(),
    reason: z.string().nullable().optional().describe("Why you couldn't decide, when you couldn't."),
  }),
  write_proposal: z.object({
    kind: PROPOSAL_KIND,
    cause: z.string().nullable().describe("The cluster key it answers, or null."),
    summary: z.string(),
    evidence: z.array(FindingSchema),
    rows: z.array(RowSchema),
    sample: z.object({ checked: z.number().int(), wrong: z.array(RowSchema) }).optional(),
    change: z.object({ what: z.string(), how: z.string(), revert: z.string() }).optional(),
    cost: z.number().optional().describe("A re-read's projected cost in US dollars."),
  }),
  write_todo: z.object({
    kind: z.enum(["cds", "class-profile", "campus-page", "hs-profile", "other"]),
    unit_id: z.string().nullable(),
    subject: z.string().describe("The college or school's name."),
    edition: z.string().nullable(),
    landing: z.string().nullable().describe("The page a person opens."),
    document_url: z.string().nullable(),
    why: TODO_WHY,
    reach: z.number().int().min(1).optional(),
    note: z.string().nullable().optional(),
  }),
  write_decision: z.object({
    key: z.string().optional().describe("A short slug; default from the question."),
    question: z.string(),
    recommends: z.string(),
    options: z.array(z.object({ answer: z.string(), effect: z.string() })).min(2),
  }),
  write_audit: z.object({ family: z.string(), checked: z.number().int().min(0), wrong: z.array(RowSchema) }),
  write_answer: z.object({ answer: z.string(), rows: z.array(RowSchema).optional() }),
} as const;

export type ToolName = keyof typeof SCHEMAS;
export type ToolInput<N extends ToolName> = z.infer<(typeof SCHEMAS)[N]>;

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function writer(ctx: StewardContext): StewardWriter {
  if (!ctx.writer) throw new Error("this mode writes no Steward documents");
  return ctx.writer;
}

const asRows = (rows: readonly ToolInput<"write_proposal">["rows"][number][] | undefined): ProposalRow[] => (rows ?? []).map((r) => ({ ...r }) as ProposalRow);

export async function writeIssueTool(ctx: StewardContext, input: ToolInput<"write_issue">) {
  const doc = await writer(ctx).writeIssue({ ...input, reason: input.reason ?? null });
  return { written: "steward.issues", key: doc.key, status: doc.status };
}

export async function writeProposalTool(ctx: StewardContext, input: ToolInput<"write_proposal">) {
  const { doc, dropped } = await writer(ctx).writeProposal({ ...input, rows: asRows(input.rows), ...(input.sample ? { sample: { checked: input.sample.checked, wrong: asRows(input.sample.wrong) } } : {}) });
  return { written: "steward.proposals", key: doc.key, rows: doc.rows.length, ...(dropped ? { dropped_declined_before: dropped } : {}) };
}

export async function writeTodoTool(ctx: StewardContext, input: ToolInput<"write_todo">) {
  const doc = await writer(ctx).writeTodo({ ...input, reach: input.reach ?? 1, note: input.note ?? null });
  return { written: "steward.todo", key: doc.key, status: doc.status };
}

export async function writeDecisionTool(ctx: StewardContext, input: ToolInput<"write_decision">) {
  const doc = await writer(ctx).writeDecision({ key: input.key ?? "", question: input.question, recommends: input.recommends, options: input.options });
  return { written: "steward.decisions", key: doc.key };
}

export async function writeAuditTool(ctx: StewardContext, input: ToolInput<"write_audit">) {
  const doc = await writer(ctx).writeAudit({ family: input.family, checked: input.checked, wrong: asRows(input.wrong) });
  return { written: "steward.audits", key: doc.key, rate: doc.rate };
}

/* ------------------------------------------------------------------ */
/* The runnable tools                                                  */
/* ------------------------------------------------------------------ */

const DESCRIPTIONS: Record<ToolName, string> = {
  list_clusters: "The review queue's open items grouped by cause (check and masked detail), largest first, with any issue already written for each.",
  read_cluster: "One cluster's items (spread across colleges) with each item's record entry (value, page, line, quote, failures) and the documents behind them.",
  read_record: "A college's CDS record for one edition: the document, its years, item counts, and the held items (or the codes asked for).",
  read_document_lines: "A document's numbered line text by sha256 (or url): from the archive, or fetched again and checked against its sha256. With a question, a cheaper reader answers from the lines with page, line and quote. Answers {unavailable, reason} when the document can't be had: that is an acquisition To do.",
  read_site_value: "What the site shows now for a registered field of a college, with its source and year as the profile cites it. Use its 'shows' as a row's 'now'.",
  read_failures: "A college's pipeline failures (discovery, fetch, read, checks), its recipe, and its To do rows.",
  write_issue: "Write your reading of one cluster (keyed by the cluster key): kind, hypothesis, findings per document read.",
  write_proposal: "Write a proposal with evidence and rows. Refused without evidence, a correct/publish row without page/line and value, or a row whose 'now' is empty.",
  write_todo: "Write an acquisition row: a document only a person can fetch, and why a machine couldn't.",
  write_decision: "Write a policy question for the owner, with your recommendation and what each answer changes.",
  write_audit: "Write the audit's result: how many values you compared and the ones the documents contradict.",
  write_answer: "Answer the owner's question on the proposal, adding rows when the answer narrows it or adds holds.",
};

/** The tools a mode gets (answer mode adds write_answer; audit mode adds write_audit). */
export function toolNames(mode: "run" | "audit" | "answer"): ToolName[] {
  const reads: ToolName[] = ["list_clusters", "read_cluster", "read_record", "read_document_lines", "read_site_value", "read_failures"];
  const writes: ToolName[] = ["write_issue", "write_proposal", "write_todo", "write_decision"];
  if (mode === "audit") return [...reads, ...writes, "write_audit"];
  if (mode === "answer") return [...reads, ...writes, "write_answer"];
  return [...reads, ...writes];
}

/** Runs one tool by name (the dry run's tests call this as the runner would). */
export async function callTool(ctx: StewardContext, name: ToolName, input: unknown, extra: { answerFor?: string } = {}): Promise<unknown> {
  ctx.progress.tool = name;
  const parsed = SCHEMAS[name].parse(input) as never;
  if (name.startsWith("write_")) return writer(ctx).serial(() => runTool(ctx, name, parsed, extra));
  return runTool(ctx, name, parsed, extra);
}

async function runTool(ctx: StewardContext, name: ToolName, parsed: never, extra: { answerFor?: string }): Promise<unknown> {
  switch (name) {
    case "list_clusters":
      return listClusters(ctx, parsed);
    case "read_cluster":
      return readCluster(ctx, parsed);
    case "read_record":
      return readRecord(ctx, parsed);
    case "read_document_lines":
      return readDocumentLines(ctx, parsed);
    case "read_site_value":
      return readSiteValue(ctx, parsed);
    case "read_failures":
      return readFailures(ctx, parsed);
    case "write_issue":
      return writeIssueTool(ctx, parsed);
    case "write_proposal":
      return writeProposalTool(ctx, parsed);
    case "write_todo":
      return writeTodoTool(ctx, parsed);
    case "write_decision":
      return writeDecisionTool(ctx, parsed);
    case "write_audit":
      return writeAuditTool(ctx, parsed);
    case "write_answer": {
      if (!extra.answerFor) throw new Error("write_answer is for answer mode");
      const a = parsed as ToolInput<"write_answer">;
      const doc = await writer(ctx).writeAnswer(extra.answerFor, a.answer, asRows(a.rows));
      return { written: "steward.proposals", key: doc.key, rows: doc.rows.length };
    }
  }
}

/** The mode's tools as `betaZodTool`s for `client.beta.messages.toolRunner`, each answering with compact JSON. */
export function stewardTools(ctx: StewardContext, mode: "run" | "audit" | "answer", extra: { answerFor?: string } = {}) {
  return toolNames(mode).map((name) =>
    betaZodTool({
      name,
      description: DESCRIPTIONS[name],
      inputSchema: SCHEMAS[name],
      run: async (input) => JSON.stringify(await callTool(ctx, name, input, extra)),
    }),
  );
}

export { reviewKey };
