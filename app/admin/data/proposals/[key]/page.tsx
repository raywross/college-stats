import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty, Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { ProposalKindChip, ProposalStatusChip } from "@/components/admin/steward/Bits";
import { EvidenceTable, ProposalRowsTable } from "@/components/admin/steward/ProposalParts";
import { ProposalApprove, type ApproveRowView } from "@/components/admin/steward/ProposalApprove";
import { approveProposalAction, askProposalAction, declineProposalAction, startProposalJobAction } from "@/app/admin/data/steward-actions";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readProposal } from "@/lib/admin/steward-reads";
import { CONFIRM_APPROVE, JOB_KINDS, TYPED_KINDS, UNDECIDED, rereadCostEach, rereadsWaiting } from "@/lib/admin/steward-actions";
import { documentHref, keyFromSegment, linkCls, reviewHref } from "@/lib/admin/steward-view";
import { dayLabel, usd } from "@/lib/admin/ops-view";
import { getData } from "@/lib/data";
import { isFieldPath } from "@/lib/fields";
import { nowAtField } from "@/lib/steward/review-rows";
import type { ProposalDoc } from "@/lib/steward/types";

export const metadata: Metadata = { title: "Proposal", robots: { index: false, follow: false } };

/**
 * `/admin/data/proposals/[key]` (specs/product/data-steward.md "Proposals"): one proposal's summary, the evidence
 * (each document opened at its page), the rows with their ticks pre-set from the recommendation, a systemic
 * proposal's change and sample, the question and answer; Approve (the ticked rows), Decline (a reason), Ask (a
 * question the Steward answers on the proposal). "On the site now" is read again from the same `citeField` the
 * profile uses, for rows that name a registered field.
 */
export default async function ProposalPage({ params }: { params: Promise<{ key: string }> }) {
  await connection();
  await requireAdmin();
  const raw = (await params).key;
  const key = keyFromSegment(raw);
  if (!key || key.length > 200) notFound();
  const supabase = await adminSupabase();
  const client = supabase as unknown as StoreClient;
  const p: ProposalDoc | null = (await readProposal(client, key)) ?? (key !== raw ? await readProposal(client, raw) : null);
  if (!p) notFound();
  const data = await getData();
  const names: Record<string, string> = {};
  for (const r of [...p.rows, ...(p.sample?.wrong ?? [])]) names[r.unit_id] ??= data.getSchoolById(r.unit_id)?.name ?? r.unit_id;
  const undecided = UNDECIDED.has(p.status);
  const costEach = p.kind === "reread" ? rereadCostEach(p) : null;
  const liveRows = p.rows.map((r) => {
    if (!r.field || !isFieldPath(r.field)) return r;
    const school = data.getSchoolById(r.unit_id) ?? null;
    return { ...r, now: nowAtField(r.field, school, data.citeField) };
  });
  const approveRows: ApproveRowView[] = liveRows.map((r, index) => ({
    index,
    unit: r.unit_id,
    college: names[r.unit_id] ?? r.unit_id,
    reviewHref: reviewHref(r.unit_id),
    label: r.field ?? r.code ?? "—",
    now: r.now,
    proposed: r.proposed,
    fromHref: documentHref(r.source.url, r.source.page),
    fromLabel: [r.source.page ? `p. ${r.source.page}` : null, r.source.line ? `line ${r.source.line}` : null].filter(Boolean).join(", ") || (r.source.url ? "The document" : "No document"),
    quote: r.source.quote,
    recommends: r.recommends,
    why: r.why ?? null,
    ticked: r.decision ? r.decision === "approved" : r.recommends === "approve",
  }));
  const waitingRereads = p.kind === "reread" && p.status === "approved" ? rereadsWaiting(p) : [];

  return (
    <>
      <PageHeader
        title={p.summary}
        back={
          <Link href="/admin/data/proposals" className={linkCls}>
            Proposals
          </Link>
        }
        chips={
          <>
            <ProposalKindChip kind={p.kind} />
            <ProposalStatusChip status={p.status} />
          </>
        }
      />
      <div className="space-y-5">
        <Panel title="Summary">
          <Fields
            items={[
              { label: "Key", value: <span className="font-mono text-xs break-all">{p.key}</span> },
              { label: "Cause", value: p.cause ? <span className="font-mono text-xs break-all">{p.cause}</span> : "—" },
              { label: "Proposed", value: `${dayLabel(p.created)} · run ${p.run}` },
              ...(typeof p.cost === "number" ? [{ label: "Projected cost", value: usd(p.cost) }] : []),
              ...(p.decided_at ? [{ label: "Decided", value: `${dayLabel(p.decided_at)}${p.decided_by ? ` by ${p.decided_by}` : ""}` }] : []),
              ...(p.decision_note ? [{ label: "Note", value: p.decision_note }] : []),
            ]}
          />
        </Panel>

        {p.change && (
          <Panel title="The change">
            <Fields
              items={[
                { label: "What", value: p.change.what },
                { label: "How", value: p.change.how },
                { label: "Reverting", value: p.change.revert },
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">Approving records the analysis for the session that writes the change; nothing changes on the site until that change ships.</p>
          </Panel>
        )}

        <Panel title="Evidence" aside={<span className="text-sm text-muted-foreground">{p.evidence.length} document{p.evidence.length === 1 ? "" : "s"} read</span>}>
          <EvidenceTable evidence={p.evidence} />
        </Panel>

        {p.sample && (
          <Panel title="Sample of what it publishes" aside={<span className="text-sm text-muted-foreground">{p.sample.wrong.length} wrong of {p.sample.checked} checked</span>}>
            {p.sample.wrong.length ? <ProposalRowsTable rows={p.sample.wrong} names={names} caption="Values in the sample the documents disagree with" /> : <Empty>Every sampled value matched its document.</Empty>}
          </Panel>
        )}

        {(p.question || p.answer) && (
          <Panel title="Question">
            <Fields
              items={[
                { label: "Asked", value: p.question ?? "—" },
                { label: "The Steward's answer", value: p.answer ?? (p.status === "asked" ? "Waiting for the Steward." : "—") },
              ]}
            />
          </Panel>
        )}

        <Panel title="Rows" aside={<span className="text-sm text-muted-foreground">{p.rows.length}</span>}>
          {undecided && p.kind !== "systemic" && p.rows.length > 0 ? (
            <ProposalApprove action={approveProposalAction} proposal={p.key} rows={approveRows} confirmWord={TYPED_KINDS.has(p.kind) ? CONFIRM_APPROVE : null} costEach={costEach} />
          ) : (
            <ProposalRowsTable rows={liveRows} names={names} caption="The proposal's rows and their decisions" />
          )}
        </Panel>

        {undecided && (
          <Panel title="Decide">
            <div className="flex flex-wrap items-start gap-3">
              {p.kind === "systemic" && (
                <AdminForm
                  action={approveProposalAction}
                  hidden={{ proposal: p.key, rows: String(p.rows.length) }}
                  trigger="Approve"
                  tone="primary"
                  pendingLabel="Approving…"
                  fields={[{ name: "note", label: "Note for the session that writes the change (optional)", type: "textarea", maxLength: 500 }]}
                  description="Records the analysis as approved. The change itself is written and reviewed as code."
                />
              )}
              <AdminForm
                action={declineProposalAction}
                hidden={{ proposal: p.key }}
                trigger="Decline"
                pendingLabel="Saving…"
                fields={[{ name: "reason", label: "Why", type: "textarea", maxLength: 500, required: true }]}
                description="Closes the proposal. Its rows aren't proposed again unless the document changes."
              />
              <AdminForm
                action={askProposalAction}
                hidden={{ proposal: p.key }}
                trigger="Ask"
                pendingLabel="Sending…"
                fields={[{ name: "question", label: "Your question", type: "textarea", maxLength: 1000, required: true }]}
                description="The Steward reads the proposal again with your question (up to $5) and answers here."
              />
            </div>
          </Panel>
        )}

        {p.status === "approved" && JOB_KINDS.has(p.kind) && (
          <Panel title="The apply job">
            <p className="mb-3 text-sm text-muted-foreground">The job applies the approved rows and marks the proposal applied. Start it again if it didn&apos;t start or failed.</p>
            <AdminForm action={startProposalJobAction} hidden={{ proposal: p.key }} trigger="Start the apply job" pendingLabel="Starting…" />
          </Panel>
        )}

        {waitingRereads.length > 0 && (
          <Panel title="Re-reads">
            <p className="mb-3 text-sm text-muted-foreground">
              {waitingRereads.length} college{waitingRereads.length === 1 ? "" : "s"} still to re-read, one run at a time: {waitingRereads.join(", ")}.
            </p>
            <AdminForm action={startProposalJobAction} hidden={{ proposal: p.key }} trigger="Start the next re-read" pendingLabel="Starting…" />
          </Panel>
        )}
      </div>
    </>
  );
}
