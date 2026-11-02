import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { DataBack } from "@/components/admin/steward/Bits";
import { ProposalsList } from "@/components/admin/steward/ProposalParts";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readProposals } from "@/lib/admin/steward-reads";
import { param } from "@/lib/admin/steward-view";
import { PROPOSAL_STATUS_LABEL, type ProposalStatus } from "@/lib/steward/types";

export const metadata: Metadata = { title: "Proposals", robots: { index: false, follow: false } };

const STATUSES = Object.keys(PROPOSAL_STATUS_LABEL) as ProposalStatus[];

/**
 * `/admin/data/proposals` (specs/product/data-steward.md "Proposals"): what the Steward proposes, systemic first, then
 * by status (open, asked, approved, applied, declined) and newest first. `?status=` shows one status.
 */
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const raw = param((await searchParams).status);
  const status = STATUSES.includes(raw as ProposalStatus) ? (raw as ProposalStatus) : null;
  const supabase = await adminSupabase();
  const proposals = await readProposals(supabase as unknown as StoreClient, status);
  const waiting = proposals.filter((p) => p.status === "open").length;

  return (
    <>
      <PageHeader title="Proposals" back={<DataBack />} subtitle="Each one is a cause the Steward checked against the documents. Nothing reaches the site until you approve it." />
      <Panel title={status ? PROPOSAL_STATUS_LABEL[status] : "All proposals"} aside={<span className="text-sm text-muted-foreground">{status ? `${proposals.length} ${PROPOSAL_STATUS_LABEL[status].toLowerCase()}` : `${waiting} open`}</span>}>
        <nav aria-label="Statuses" className="mb-3 flex flex-wrap gap-2 text-sm">
          {[null, ...STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={s ? `/admin/data/proposals?status=${s}` : "/admin/data/proposals"}
              aria-current={s === status ? "page" : undefined}
              className={`inline-flex min-h-10 items-center rounded-full border px-4 ${s === status ? "border-primary font-semibold" : "border-border"}`}
            >
              {s ? PROPOSAL_STATUS_LABEL[s] : "All"}
            </Link>
          ))}
        </nav>
        <ProposalsList proposals={proposals} />
      </Panel>
    </>
  );
}
