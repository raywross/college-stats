import Link from "next/link";
import { Empty } from "@/components/admin/Panel";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { DocLink, ProposalKindChip, ProposalStatusChip, Recommends, StewardWords } from "@/components/admin/steward/Bits";
import { dayLabel } from "@/lib/admin/ops-view";
import { editionOf, linkCls, proposalHref, reviewHref } from "@/lib/admin/steward-view";
import type { Finding, ProposalDoc, ProposalRow } from "@/lib/steward/types";
import { codeLabel } from "@/lib/admin/words";

const evidenceColumns: readonly Column<Finding>[] = [
  {
    key: "college",
    header: "College",
    role: "title",
    cell: (f) => (
      <Link href={reviewHref(f.unit_id)} className={`inline-flex min-h-11 items-center ${linkCls}`}>
        {f.unit_id}
      </Link>
    ),
  },
  { key: "edition", header: "Edition", cell: (f) => editionOf(f) ?? "—" },
  { key: "from", header: "From", cell: (f) => <DocLink url={f.url} page={f.page} line={f.line} /> },
  { key: "shows", header: "Shows", cell: (f) => <StewardWords text={f.shows} /> },
];

/** The evidence: one line per document the Steward read, with the document opened at the page. */
export function EvidenceTable({ evidence }: { evidence: Finding[] }) {
  return <ResponsiveTable rows={evidence} columns={evidenceColumns} rowKey={(f, i = evidence.indexOf(f)) => `${f.unit_id}-${i}`} caption="What each document the Steward read shows" empty="No evidence recorded." />;
}

const proposalRowColumns = (names: Record<string, string>): readonly Column<ProposalRow>[] => [
  {
    key: "college",
    header: "College",
    role: "title",
    cell: (r) => (
      <Link href={reviewHref(r.unit_id)} className={`inline-flex min-h-11 items-center ${linkCls}`}>
        {names[r.unit_id] ?? r.unit_id}
      </Link>
    ),
  },
  { key: "field", header: "Field", cell: (r) => r.field ?? (r.code ? codeLabel(r.code) : "—") },
  { key: "now", header: "On the site now", cell: (r) => r.now },
  { key: "proposed", header: "Proposed", cell: (r) => <StewardWords text={r.proposed} /> },
  {
    key: "from",
    header: "From",
    role: "detail",
    cell: (r) => (
      <>
        <DocLink url={r.source.url} page={r.source.page} line={r.source.line} />
        {r.source.quote && <span className="mt-0.5 block break-words">&ldquo;{r.source.quote}&rdquo;</span>}
      </>
    ),
  },
  { key: "recommends", header: "Recommends", cell: (r) => <Recommends recommends={r.recommends} why={r.why} /> },
  {
    key: "decision",
    header: "Decision",
    cell: (r) => (
      <>
        {r.decision ? (r.decision === "approved" ? "Approved" : "Declined") : "—"}
        {r.decisionNote && <span className="block text-muted-foreground">{r.decisionNote}</span>}
      </>
    ),
  },
];

/** A proposal's rows without ticks: a decided proposal, or a systemic proposal's sample. */
export function ProposalRowsTable({ rows, names, caption }: { rows: ProposalRow[]; names: Record<string, string>; caption: string }) {
  return <ResponsiveTable rows={rows} columns={proposalRowColumns(names)} rowKey={(r, i = rows.indexOf(r)) => `${r.unit_id}-${i}`} caption={caption} empty="No rows." />;
}

/** The Proposals list: each proposal's kind, status, summary, rows and date, linking its page. */
export function ProposalsList({ proposals }: { proposals: ProposalDoc[] }) {
  if (!proposals.length) return <Empty>No proposals here.</Empty>;
  return (
    <ul className="divide-y rounded-2xl border bg-background" aria-label="Proposals">
      {proposals.map((p) => (
        <li key={p.key} className="space-y-1 p-3 text-sm" data-proposal={p.key}>
          <div className="flex flex-wrap items-center gap-2">
            <ProposalKindChip kind={p.kind} />
            <ProposalStatusChip status={p.status} />
            <Link href={proposalHref(p.key)} className={`inline-flex min-h-11 items-center font-semibold break-all ${linkCls}`}>
              {p.key}
            </Link>
          </div>
          <p className="break-words">
            <StewardWords text={p.summary} />
          </p>
          <p className="text-xs text-muted-foreground">
            {p.rows.length} row{p.rows.length === 1 ? "" : "s"} · {p.evidence.length} document{p.evidence.length === 1 ? "" : "s"} read · {dayLabel(p.created)}
            {p.question && p.status === "asked" ? " · question waiting for the Steward" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
