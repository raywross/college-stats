/**
 * The Steward's writer: validates each document the agent writes and puts it in the run's change set, `steward.*`
 * collections only (specs/product/data-steward.md "What it writes, and what it may not do"). The refusals (the build
 * brief's "Tools" contract), each a `WriteRefused` the tool hands back to the model as an error to fix:
 * - a proposal without evidence;
 * - a `correct` or `publish` row without `value`, or without `source.page` (a workbook's row cites `source.quote`
 *   with its cell instead), or whose `field` isn't a registered field an admin edit may set;
 * - any row whose `now` (what the site shows) is empty;
 * - a systemic proposal without its change (what, how, revert).
 *
 * And what the owner already decided stays decided: a row the owner declined (same college, field or code, and
 * document) isn't proposed again; an issue the owner left keeps its status and reason; a To do row a person settled
 * keeps its status. Every document gets the run's id and the clock's time.
 */
import type { DecisionDoc, AuditDoc, Finding, IssueDoc, ProposalDoc, ProposalRow, TodoDoc } from "../../../lib/steward/types.ts";
import type { ManifestEntry } from "../../../lib/cds-sections.ts";
import { editProblem } from "../../../lib/data-platform/edits.ts";
import { COLLECTIONS } from "../data-platform/layers.mts";
import { KEY_MAX, type ChangeSetHandle, type DataStore } from "../data-platform/store.mts";

/** A write the writer refuses, with the reason the model reads. */
export class WriteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteRefused";
  }
}

const STEWARD = new Set<string>(Object.values(COLLECTIONS.steward));

/** "Number on line" → "number-on-line", at most `max` characters. */
export function slug(s: string, max = 80): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || "x"
  );
}

export type IssueInput = Omit<IssueDoc, "run" | "updated" | "proposals" | "reason" | "status"> & { status?: IssueDoc["status"]; reason?: string | null; proposals?: string[] };
export type ProposalInput = Omit<ProposalDoc, "key" | "status" | "run" | "created"> & { key?: string };
export type TodoInput = Omit<TodoDoc, "key" | "status" | "attempts" | "updated" | "route" | "demand" | "host"> & {
  host?: string | null; status?: TodoDoc["status"]; route?: TodoDoc["route"]; demand?: number; attempts?: TodoDoc["attempts"] };
export type DecisionInput = Pick<DecisionDoc, "key" | "question" | "recommends" | "options">;
export type AuditInput = Pick<AuditDoc, "family" | "checked" | "wrong">;

export interface WriteCounts {
  issues: number;
  proposals: number;
  todo: number;
  decisions: number;
  audits: number;
}

export interface WriterOptions {
  run: string;
  now: () => Date;
  /** The manifest entry for a sha256 (to tell a workbook row, which cites a cell); null when unknown. */
  manifest?: (sha256: string) => Promise<ManifestEntry | null>;
}

export class StewardWriter {
  readonly counts: WriteCounts = { issues: 0, proposals: 0, todo: 0, decisions: 0, audits: 0 };
  /** Keys written this run, by collection. */
  readonly written = new Map<string, Set<string>>();
  private declined: Set<string> | null = null;
  private readonly store: DataStore;
  private readonly handle: ChangeSetHandle;
  private readonly opts: WriterOptions;

  constructor(store: DataStore, handle: ChangeSetHandle, opts: WriterOptions) {
    this.store = store;
    this.handle = handle;
    this.opts = opts;
  }

  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Runs writes one at a time, in call order: the tool runner runs a turn's tool calls together, and a proposal reads
   * the issue its cause names (written in the same turn) to list itself on it.
   */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private stamp(): string {
    return this.opts.now().toISOString();
  }

  /** Writes one document to a `steward.*` collection (refuses any other). */
  async put(collection: string, key: string, body: unknown): Promise<void> {
    if (!STEWARD.has(collection)) throw new WriteRefused(`the Steward writes only steward.* collections, not ${collection}`);
    if (!key || key.length > KEY_MAX) throw new WriteRefused(`a ${collection} key must be 1 to ${KEY_MAX} characters`);
    await this.handle.write(collection, [{ key, body }]);
    (this.written.get(collection) ?? this.written.set(collection, new Set()).get(collection)!).add(key);
  }

  async writeIssue(input: IssueInput): Promise<IssueDoc> {
    if (!input.key) throw new WriteRefused("an issue needs its cluster key");
    if (!input.hypothesis?.trim()) throw new WriteRefused("an issue needs a hypothesis");
    const before = await this.store.readOne<IssueDoc>(COLLECTIONS.steward.issues, input.key);
    const left = before?.status === "left";
    const doc: IssueDoc = {
      key: input.key,
      kind: input.kind,
      status: left ? "left" : (input.status ?? (input.proposals?.length ? "proposed" : "investigating")),
      hypothesis: input.hypothesis.trim(),
      findings: input.findings ?? [],
      proposals: [...new Set([...(before?.proposals ?? []), ...(input.proposals ?? [])])],
      reason: left ? before!.reason : (input.reason ?? null),
      run: this.opts.run,
      updated: this.stamp(),
    };
    await this.put(COLLECTIONS.steward.issues, doc.key, doc);
    this.counts.issues++;
    return doc;
  }

  /** Rows the owner declined before: `unit|field or code|sha256`. */
  private async declinedRows(): Promise<Set<string>> {
    if (this.declined) return this.declined;
    const out = new Set<string>();
    for (const p of (await this.store.read<ProposalDoc>(COLLECTIONS.steward.proposals)).values()) {
      for (const r of p.rows ?? []) if (r.decision === "declined") out.add(rowIdentity(r));
    }
    this.declined = out;
    return out;
  }

  /** Checks a row by the proposal's kind; returns the refusal, or null. */
  async rowProblem(kind: ProposalDoc["kind"], r: ProposalRow, i: number): Promise<string | null> {
    const at = `row ${i + 1} (${r.unit_id} ${r.field ?? r.code ?? ""})`;
    if (!r.unit_id) return `${at}: no unit_id`;
    if (!r.now?.trim()) return `${at}: "now" is empty; say what the site shows (read_site_value), or "Not shown" when it shows nothing`;
    if (!r.proposed?.trim()) return `${at}: "proposed" is empty`;
    if (kind === "correct" || kind === "publish") {
      if (r.value === undefined || r.value === null || r.value === "") return `${at}: a ${kind} row needs the value to publish`;
      if (!r.field) return `${at}: a ${kind} row needs a registered field path`;
      const edit = editProblem({ unit_id: r.unit_id, path: r.field });
      if (edit) return `${at}: ${edit}`;
      if (r.source?.page == null) {
        const entry = r.sha256 && this.opts.manifest ? await this.opts.manifest(r.sha256) : null;
        const workbook = entry?.type.startsWith("xlsx") ?? false;
        if (!workbook || !r.source?.quote?.trim()) return `${at}: a ${kind} row cites source.page and source.line from the document (a workbook row cites source.quote with its cell)`;
      } else if (r.source.line == null && !r.source.quote?.trim()) {
        return `${at}: cite source.line or quote the line`;
      }
    }
    if ((kind === "hold" || kind === "reject") && !r.code && !r.item) return `${at}: a ${kind} row names the code or the queue item`;
    if (kind === "hold" && (!r.edition || !r.code)) return `${at}: a hold names the code and the edition`;
    if (kind === "refile" && (!r.sha256 || !r.edition)) return `${at}: a refile names the document (sha256) and the edition it belongs under`;
    if (kind === "recipe" && !["sources.add", "sources.drop", "rediscover"].includes(r.field ?? "")) return `${at}: a recipe row's field is sources.add, sources.drop, or rediscover`;
    if (kind === "recipe" && r.field !== "rediscover" && (typeof r.value !== "string" || !/^https?:\/\//.test(r.value))) return `${at}: ${r.field} needs the URL as value`;
    return null;
  }

  async writeProposal(input: ProposalInput): Promise<{ doc: ProposalDoc; dropped: number }> {
    if (!input.evidence?.length) throw new WriteRefused("a proposal needs evidence: one finding per document read, with page and line");
    if (!input.summary?.trim()) throw new WriteRefused("a proposal needs a summary");
    if (input.kind === "systemic" && !(input.change?.what && input.change.how && input.change.revert)) throw new WriteRefused("a systemic proposal needs change: what, how, and how to revert");
    if (input.kind !== "systemic" && !input.rows?.length) throw new WriteRefused(`a ${input.kind} proposal needs rows`);
    const problems: string[] = [];
    for (const [i, r] of (input.rows ?? []).entries()) {
      const p = await this.rowProblem(input.kind, r, i);
      if (p) problems.push(p);
    }
    for (const [i, r] of (input.sample?.wrong ?? []).entries()) if (!r.now?.trim()) problems.push(`sample row ${i + 1}: "now" is empty`);
    if (problems.length) throw new WriteRefused(problems.join("; "));
    const declined = await this.declinedRows();
    const rows = (input.rows ?? []).filter((r) => !declined.has(rowIdentity(r))).map((r) => {
        const row = { ...r };
        delete row.decision;
        delete row.decisionNote;
        return row;
      });
    const dropped = (input.rows?.length ?? 0) - rows.length;
    if (input.kind !== "systemic" && !rows.length) throw new WriteRefused("every row was declined by the owner before for this document; nothing to propose");
    const key = input.key ? input.key : `${input.kind}-${slug(input.cause ?? rows[0]?.unit_id ?? "proposal")}-${slug(this.opts.run, 40)}`;
    const doc: ProposalDoc = {
      key,
      kind: input.kind,
      cause: input.cause ?? null,
      status: "open",
      summary: input.summary.trim(),
      evidence: input.evidence,
      rows,
      ...(input.sample ? { sample: input.sample } : {}),
      ...(input.change ? { change: input.change } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      question: null,
      answer: null,
      run: this.opts.run,
      created: this.stamp(),
    };
    await this.put(COLLECTIONS.steward.proposals, key, doc);
    this.counts.proposals++;
    // The issue it answers lists it and moves to "proposed".
    if (doc.cause) {
      const issue = await this.store.readOne<IssueDoc>(COLLECTIONS.steward.issues, doc.cause);
      if (issue && !issue.proposals.includes(key)) {
        await this.put(COLLECTIONS.steward.issues, issue.key, { ...issue, proposals: [...issue.proposals, key], status: issue.status === "left" ? "left" : "proposed", run: this.opts.run, updated: this.stamp() });
      }
    }
    return { doc, dropped };
  }

  /** The owner's question answered (answer mode): the answer, any added rows, and the proposal open again. */
  async writeAnswer(key: string, answer: string, rows: ProposalRow[] = []): Promise<ProposalDoc> {
    const p = await this.store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, key);
    if (!p) throw new WriteRefused(`no proposal ${key}`);
    if (!answer.trim()) throw new WriteRefused("the answer is empty");
    const problems: string[] = [];
    for (const [i, r] of rows.entries()) {
      const why = await this.rowProblem(p.kind, r, i);
      if (why) problems.push(why);
    }
    if (problems.length) throw new WriteRefused(problems.join("; "));
    const doc: ProposalDoc = { ...p, answer: answer.trim(), rows: [...p.rows, ...rows], status: p.status === "asked" ? "open" : p.status };
    await this.put(COLLECTIONS.steward.proposals, key, doc);
    return doc;
  }

  async writeTodo(input: TodoInput): Promise<TodoDoc> {
    if (!input.subject?.trim()) throw new WriteRefused("a To do row needs its subject (the college or school)");
    const key = `${input.kind}:${input.unit_id ?? slug(input.subject, 60)}:${input.edition ?? "-"}`;
    const before = await this.store.readOne<TodoDoc>(COLLECTIONS.steward.todo, key);
    const settled = before && before.status !== "open";
    const doc: TodoDoc = {
      key,
      kind: input.kind,
      unit_id: input.unit_id ?? null,
      subject: input.subject.trim(),
      edition: input.edition ?? null,
      landing: input.landing ?? before?.landing ?? null,
      document_url: input.document_url ?? before?.document_url ?? null,
      host: input.host ?? (input.landing ? hostOf(input.landing) : (before?.host ?? null)),
      why: input.why,
      reach: input.reach ?? 1,
      demand: input.demand ?? before?.demand ?? 0,
      status: settled ? before!.status : (input.status ?? "open"),
      route: input.route ?? before?.route ?? null,
      attempts: [...(before?.attempts ?? []), ...(input.attempts ?? [])],
      note: input.note ?? before?.note ?? null,
      updated: this.stamp(),
    };
    await this.put(COLLECTIONS.steward.todo, key, doc);
    this.counts.todo++;
    return doc;
  }

  async writeDecision(input: DecisionInput): Promise<DecisionDoc> {
    if (!input.question?.trim() || !input.recommends?.trim()) throw new WriteRefused("a decision needs the question and your recommendation");
    if ((input.options?.length ?? 0) < 2) throw new WriteRefused("a decision needs at least two options, each with what it changes");
    const key = slug(input.key || input.question, 80);
    const before = await this.store.readOne<DecisionDoc>(COLLECTIONS.steward.decisions, key);
    if (before?.answer) throw new WriteRefused(`the owner already decided "${before.question}": ${before.answer}`);
    const doc: DecisionDoc = {
      key,
      question: input.question.trim(),
      recommends: input.recommends.trim(),
      options: input.options,
      answer: null,
      note: null,
      decided_by: null,
      decided_at: null,
      run: this.opts.run,
      created: before?.created ?? this.stamp(),
    };
    await this.put(COLLECTIONS.steward.decisions, key, doc);
    this.counts.decisions++;
    return doc;
  }

  async writeAudit(input: AuditInput): Promise<AuditDoc> {
    if (!input.family) throw new WriteRefused("an audit names its family");
    if (!Number.isInteger(input.checked) || input.checked < 0) throw new WriteRefused("checked is how many values you compared with their documents");
    if ((input.wrong?.length ?? 0) > input.checked) throw new WriteRefused("more values wrong than checked");
    for (const [i, r] of (input.wrong ?? []).entries()) {
      if (!r.now?.trim()) throw new WriteRefused(`wrong row ${i + 1}: "now" is empty`);
      if (r.source?.page == null && !r.source?.quote) throw new WriteRefused(`wrong row ${i + 1}: cite the page and line, or quote the line`);
    }
    const doc: AuditDoc = {
      key: `${slug(input.family, 40)}-${slug(this.opts.run, 40)}`,
      family: input.family,
      checked: input.checked,
      wrong: input.wrong ?? [],
      rate: input.checked ? Math.round(((input.wrong?.length ?? 0) / input.checked) * 10000) / 10000 : 0,
      run: this.opts.run,
      created: this.stamp(),
    };
    await this.put(COLLECTIONS.steward.audits, doc.key, doc);
    this.counts.audits++;
    return doc;
  }
}

/** A row's identity for "declined before": college, field or code, and document. */
export const rowIdentity = (r: Pick<ProposalRow, "unit_id" | "field" | "code" | "sha256">) => `${r.unit_id}|${r.field ?? r.code ?? ""}|${r.sha256 ?? ""}`;

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export type { Finding };
