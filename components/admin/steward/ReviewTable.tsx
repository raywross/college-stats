import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty } from "@/components/admin/Panel";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { DocLink, ProposalStatusChip, Recommends } from "@/components/admin/steward/Bits";
import { acceptHeldAction, rediscoverHeldAction, rejectHeldAction } from "@/app/admin/data/actions";
import { decideRowAction, leaveItemAction } from "@/app/admin/steward/actions";
import { editionOf, linkCls, proposalHref } from "@/lib/admin/steward-view";
import { PROPOSAL_KIND_LABEL } from "@/lib/steward/types";
import type { ReviewGroup, ReviewRow } from "@/lib/steward/review-rows";
import { checkLabel, codeLabel, codeName } from "@/lib/admin/words";

const UNDECIDED = new Set(["open", "asked"]);

function ItemActions({ row }: { row: ReviewRow }) {
  if (!row.item) return null;
  const issues = [...new Map(row.issues.map((i) => [i.cluster, i])).values()];
  return (
    <>
      {row.accept?.ok ? (
        <AdminForm
          action={acceptHeldAction}
          hidden={{ item: row.id }}
          trigger="Accept the value"
          tone="primary"
          pendingLabel="Saving…"
          sheet
          description={<>Saves {Object.keys(row.accept.values).join(", ")} as edits by Quad, noting the document, and marks the item accepted.</>}
        />
      ) : row.accept ? (
        <p className="text-xs text-muted-foreground">Can&apos;t accept: {row.accept.message}</p>
      ) : null}
      <AdminForm
        action={rejectHeldAction}
        hidden={{ item: row.id }}
        trigger="Reject"
        pendingLabel="Saving…"
        sheet
        fields={[{ name: "note", label: "Why (optional)", type: "textarea", maxLength: 500 }]}
        description="Keeps this value off the site."
      />
      {issues.length > 0 && (
        <AdminForm
          action={leaveItemAction}
          hidden={issues.length === 1 ? { item: row.id, issue: issues[0].cluster } : { item: row.id }}
          trigger="Leave"
          pendingLabel="Saving…"
          sheet
          fields={[
            ...(issues.length > 1 ? [{ name: "issue", label: "Which cause", type: "select" as const, options: issues.map((i) => ({ value: i.cluster, label: i.check })), defaultValue: issues[0].cluster }] : []),
            { name: "reason", label: "Why it stays queued", type: "textarea" as const, maxLength: 500, required: true },
          ]}
          description="The item stays queued; your reason goes on its cause for the Steward."
        />
      )}
      {/* From Holds, which folded into this page (specs/product/admin-redesign.md "Owner decisions" 2). */}
      <AdminForm action={rediscoverHeldAction} hidden={{ item: row.id }} trigger="Re-run discovery" pendingLabel="Starting…" sheet description="Starts a run that finds this college's documents from scratch." />
    </>
  );
}

function ProposalTick({ row }: { row: ReviewRow }) {
  const p = row.proposal;
  if (!p || p.kind === "systemic" || !UNDECIDED.has(p.status)) return null;
  const hidden = { proposal: p.key, row: String(p.row), unit: row.unit_id };
  return (
    <>
      {row.decision !== "approved" && (
        <AdminForm action={decideRowAction} hidden={{ ...hidden, decision: "approved" }} trigger="Approve" pendingLabel="Saving…" description="Ticks this row on the proposal. Approve on the proposal applies it." />
      )}
      {row.decision !== "declined" && (
        <AdminForm
          action={decideRowAction}
          hidden={{ ...hidden, decision: "declined" }}
          trigger="Decline"
          pendingLabel="Saving…"
          sheet
          fields={[{ name: "note", label: "Why (optional)", type: "text", maxLength: 500 }]}
          description="Unticks this row on the proposal; the Steward won't propose it again unless the document changes."
        />
      )}
    </>
  );
}

const columns: readonly Column<ReviewRow>[] = [
  {
    key: "field",
    header: "Field",
    role: "title",
    cell: (r) => (
      <>
        {r.label}
        {editionOf(r) && <span className="block text-xs font-normal text-muted-foreground">CDS {editionOf(r)}</span>}
        {r.question && <span className="block text-xs font-normal text-muted-foreground">{r.question}</span>}
      </>
    ),
  },
  { key: "now", header: "On the site now", cell: (r) => r.now },
  { key: "proposed", header: "Proposed", cell: (r) => r.proposed ?? <span className="text-muted-foreground">{r.item ? `Read: ${r.value ?? "nothing"}` : "—"}</span> },
  {
    key: "from",
    header: "From",
    role: "detail",
    cell: (r) => (
      <>
        {r.from ? <DocLink url={r.from.url ?? r.from.document} page={r.from.page} line={r.from.line} /> : <span className="text-muted-foreground">No document</span>}
        {r.from?.cell && <span className="block text-muted-foreground">cell {r.from.cell}</span>}
        {r.from?.quote && <span className="mt-0.5 block break-words">&ldquo;{r.from.quote}&rdquo;</span>}
      </>
    ),
  },
  {
    key: "finding",
    header: "Finding",
    role: "detail",
    cell: (r) =>
      r.issues.length ? (
        <ul className="space-y-0.5">
          {r.issues.slice(0, 3).map((i, n) => (
            <li key={n}>
              <span className="font-semibold" title={i.check}>{checkLabel(i.check)}</span>
              {i.detail && <span className="text-muted-foreground">: {i.detail}</span>}
            </li>
          ))}
          {r.issues.length > 3 && <li className="text-muted-foreground">and {r.issues.length - 3} more</li>}
        </ul>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
  },
  { key: "recommends", header: "Recommends", cell: (r) => <Recommends recommends={r.recommends} why={r.why} /> },
  {
    key: "proposal",
    header: "Proposal",
    role: "detail",
    cell: (r) =>
      r.proposal ? (
        <span className="space-y-1">
          <Link href={proposalHref(r.proposal.key)} className={`block ${linkCls}`}>
            {PROPOSAL_KIND_LABEL[r.proposal.kind]}, row {r.proposal.row + 1}
          </Link>
          <ProposalStatusChip status={r.proposal.status} />
          {r.decision && <span className="block text-muted-foreground">{r.decision === "approved" ? "Approved" : "Declined"} here</span>}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "actions",
    header: "Actions",
    role: "actions",
    cell: (r) => (
      <>
        <ProposalTick row={r} />
        <ItemActions row={r} />
      </>
    ),
  },
];

/**
 * One college's Review rows (specs/product/data-steward.md "The college's Review page"), through `ResponsiveTable`,
 * one per code: the field, what the site shows now, what is proposed, the document and issues (folded on a phone),
 * the recommendation and the proposal it belongs to, and the actions.
 */
export function ReviewTable({ groups }: { groups: ReviewGroup[] }) {
  if (!groups.length) return <Empty>Nothing is pending for this college.</Empty>;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.code} aria-label={g.label} className="space-y-2">
          <h3 className="font-display text-base font-bold">
            {codeName(g.label) ? codeLabel(g.label) : g.label} <span className="font-mono text-xs font-normal text-muted-foreground">{g.code}</span>
          </h3>
          <ResponsiveTable rows={g.rows} columns={columns} rowKey={(r) => String(r.id)} caption={`Pending rows for ${g.label}`} empty="Nothing is pending for this code." />
        </section>
      ))}
    </div>
  );
}
