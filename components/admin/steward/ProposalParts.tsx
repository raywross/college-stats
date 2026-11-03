import Link from "next/link";
import { Empty } from "@/components/admin/Panel";
import { DocLink, ProposalKindChip, ProposalStatusChip, Recommends } from "@/components/admin/steward/Bits";
import { dayLabel } from "@/lib/admin/ops-view";
import { editionOf, linkCls, proposalHref, reviewHref } from "@/lib/admin/steward-view";
import type { Finding, ProposalDoc, ProposalRow } from "@/lib/steward/types";

const th = "px-3 py-2 font-medium";

/** The evidence: one line per document the Steward read, with the document opened at the page. */
export function EvidenceTable({ evidence }: { evidence: Finding[] }) {
  if (!evidence.length) return <Empty>No evidence recorded.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">What each document the Steward read shows</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className={th}>
              College
            </th>
            <th scope="col" className={th}>
              Edition
            </th>
            <th scope="col" className={th}>
              From
            </th>
            <th scope="col" className={th}>
              Shows
            </th>
          </tr>
        </thead>
        <tbody>
          {evidence.map((f, i) => (
            <tr key={i} className="border-t border-border align-top">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                <Link href={reviewHref(f.unit_id)} className={linkCls}>
                  {f.unit_id}
                </Link>
              </th>
              <td className="px-3 py-2">{editionOf(f) ?? "—"}</td>
              <td className="max-w-56 px-3 py-2 text-xs">
                <DocLink url={f.url} page={f.page} line={f.line} />
              </td>
              <td className="px-3 py-2">{f.shows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A proposal's rows without ticks: a decided proposal, or a systemic proposal's sample. */
export function ProposalRowsTable({ rows, names, caption }: { rows: ProposalRow[]; names: Record<string, string>; caption: string }) {
  if (!rows.length) return <Empty>No rows.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[52rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className={th}>
              College
            </th>
            <th scope="col" className={th}>
              Field
            </th>
            <th scope="col" className={th}>
              On the site now
            </th>
            <th scope="col" className={th}>
              Proposed
            </th>
            <th scope="col" className={th}>
              From
            </th>
            <th scope="col" className={th}>
              Recommends
            </th>
            <th scope="col" className={th}>
              Decision
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                <Link href={reviewHref(r.unit_id)} className={linkCls}>
                  {names[r.unit_id] ?? r.unit_id}
                </Link>
              </th>
              <td className="px-3 py-2">{r.field ?? r.code ?? "—"}</td>
              <td className="px-3 py-2">{r.now}</td>
              <td className="px-3 py-2 font-medium">{r.proposed}</td>
              <td className="max-w-56 px-3 py-2 text-xs">
                <DocLink url={r.source.url} page={r.source.page} line={r.source.line} />
                {r.source.quote && <span className="mt-0.5 block break-words">&ldquo;{r.source.quote}&rdquo;</span>}
              </td>
              <td className="px-3 py-2 text-xs">
                <Recommends recommends={r.recommends} why={r.why} />
              </td>
              <td className="px-3 py-2 text-xs">
                {r.decision ? (r.decision === "approved" ? "Approved" : "Declined") : "—"}
                {r.decisionNote && <span className="block text-muted-foreground">{r.decisionNote}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
            <Link href={proposalHref(p.key)} className={`font-semibold break-all ${linkCls}`}>
              {p.key}
            </Link>
          </div>
          <p className="break-words">{p.summary}</p>
          <p className="text-xs text-muted-foreground">
            {p.rows.length} row{p.rows.length === 1 ? "" : "s"} · {p.evidence.length} document{p.evidence.length === 1 ? "" : "s"} read · {dayLabel(p.created)}
            {p.question && p.status === "asked" ? " · question waiting for the Steward" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
