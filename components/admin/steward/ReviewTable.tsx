import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty } from "@/components/admin/Panel";
import { DocLink, ProposalStatusChip, Recommends } from "@/components/admin/steward/Bits";
import { acceptHeldAction, rejectHeldAction } from "@/app/admin/data/actions";
import { decideRowAction, leaveItemAction } from "@/app/admin/data/steward-actions";
import { editionOf, linkCls, proposalHref } from "@/lib/admin/steward-view";
import { PROPOSAL_KIND_LABEL } from "@/lib/steward/types";
import type { ReviewGroup, ReviewRow } from "@/lib/steward/review-rows";

const th = "px-3 py-2 font-medium";
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
          description={<>Saves {Object.keys(row.accept.values).join(", ")} as edits by Quad, noting the document, and marks the item accepted.</>}
        />
      ) : row.accept ? (
        <p className="max-w-56 text-xs text-muted-foreground">Can&apos;t accept: {row.accept.message}</p>
      ) : null}
      <AdminForm
        action={rejectHeldAction}
        hidden={{ item: row.id }}
        trigger="Reject"
        pendingLabel="Saving…"
        fields={[{ name: "note", label: "Why (optional)", type: "textarea", maxLength: 500 }]}
        description="Keeps this value off the site."
      />
      {issues.length > 0 && (
        <AdminForm
          action={leaveItemAction}
          hidden={issues.length === 1 ? { item: row.id, issue: issues[0].cluster } : { item: row.id }}
          trigger="Leave"
          pendingLabel="Saving…"
          fields={[
            ...(issues.length > 1 ? [{ name: "issue", label: "Which cause", type: "select" as const, options: issues.map((i) => ({ value: i.cluster, label: i.check })), defaultValue: issues[0].cluster }] : []),
            { name: "reason", label: "Why it stays queued", type: "textarea" as const, maxLength: 500, required: true },
          ]}
          description="The item stays queued; your reason goes on its cause for the Steward."
        />
      )}
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
          fields={[{ name: "note", label: "Why (optional)", type: "text", maxLength: 500 }]}
          description="Unticks this row on the proposal; the Steward won't propose it again unless the document changes."
        />
      )}
    </>
  );
}

/**
 * One college's Review rows (specs/product/data-steward.md "The college's Review page"), a table per code: the field,
 * what the site shows now, what is proposed, the document at the page with the quote, the issues, the
 * recommendation and the proposal it belongs to; Accept the value, Reject and Leave on a queued item, and a proposal
 * row's own Approve or Decline (recorded on the proposal too). Wide: scrolls in its own box on a phone.
 */
export function ReviewTable({ groups }: { groups: ReviewGroup[] }) {
  if (!groups.length) return <Empty>Nothing is pending for this college.</Empty>;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.code} aria-label={g.label} className="space-y-2">
          <h3 className="font-display text-base font-bold">
            {g.label} <span className="font-mono text-xs font-normal text-muted-foreground">{g.code}</span>
          </h3>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[64rem] text-sm">
              <caption className="sr-only">Pending rows for {g.label}</caption>
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
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
                    Issue
                  </th>
                  <th scope="col" className={th}>
                    Recommends
                  </th>
                  <th scope="col" className={th}>
                    Proposal
                  </th>
                  <th scope="col" className={th}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top" data-row={r.id}>
                    <th scope="row" className="max-w-56 px-3 py-2 text-left font-medium">
                      {r.label}
                      {editionOf(r) && <span className="block text-xs font-normal text-muted-foreground">CDS {editionOf(r)}</span>}
                      {r.question && <span className="block text-xs font-normal text-muted-foreground">{r.question}</span>}
                    </th>
                    <td className="px-3 py-2" data-now>
                      {r.now}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.proposed ?? <span className="font-normal text-muted-foreground">{r.item ? `Read: ${r.value ?? "nothing"}` : "—"}</span>}</td>
                    <td className="max-w-56 px-3 py-2 text-xs">
                      {r.from ? <DocLink url={r.from.url ?? r.from.document} page={r.from.page} line={r.from.line} /> : <span className="text-muted-foreground">No document</span>}
                      {r.from?.cell && <span className="block text-muted-foreground">cell {r.from.cell}</span>}
                      {r.from?.quote && <span className="mt-0.5 block break-words">&ldquo;{r.from.quote}&rdquo;</span>}
                    </td>
                    <td className="max-w-64 px-3 py-2 text-xs">
                      {r.issues.length ? (
                        <ul className="space-y-0.5">
                          {r.issues.slice(0, 3).map((i, n) => (
                            <li key={n}>
                              <span className="font-semibold">{i.check}</span>
                              {i.detail && <span className="text-muted-foreground">: {i.detail}</span>}
                            </li>
                          ))}
                          {r.issues.length > 3 && <li className="text-muted-foreground">and {r.issues.length - 3} more</li>}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Recommends recommends={r.recommends} why={r.why} />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.proposal ? (
                        <span className="space-y-1">
                          <Link href={proposalHref(r.proposal.key)} className={`block ${linkCls}`}>
                            {PROPOSAL_KIND_LABEL[r.proposal.kind]}, row {r.proposal.row + 1}
                          </Link>
                          <ProposalStatusChip status={r.proposal.status} />
                          {r.decision && <span className="block text-muted-foreground">{r.decision === "approved" ? "Approved" : "Declined"} here</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-44 flex-col items-start gap-2">
                        <ProposalTick row={r} />
                        <ItemActions row={r} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
