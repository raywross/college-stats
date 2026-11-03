import type { Metadata } from "next";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { DataBack } from "@/components/admin/steward/Bits";
import { ProposalRowsTable } from "@/components/admin/steward/ProposalParts";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readAudits } from "@/lib/admin/steward-reads";
import { pct } from "@/lib/admin/steward-view";
import { dayLabel } from "@/lib/admin/ops-view";
import { getData } from "@/lib/data";
import type { AuditDoc } from "@/lib/steward/types";

export const metadata: Metadata = { title: "Audits", robots: { index: false, follow: false } };

/** Above this share wrong, an audit opens an issue (specs/product/data-steward.md "What a run does", step 5). */
const ISSUE_RATE = 0.05;

/**
 * `/admin/data/audits` (specs/product/data-steward.md "What a run does", Audit): per check family, the latest sample
 * of passed values compared with their documents, its error rate, and the values found wrong, each linking the
 * college's Review page; the family's earlier samples as a line.
 */
export default async function AuditsPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const audits = await readAudits(supabase as unknown as StoreClient);
  const byFamily = new Map<string, AuditDoc[]>();
  for (const a of audits) byFamily.set(a.family, [...(byFamily.get(a.family) ?? []), a]);
  const data = await getData();
  const names: Record<string, string> = {};
  for (const a of audits) for (const r of a.wrong) names[r.unit_id] ??= data.getSchoolById(r.unit_id)?.name ?? r.unit_id;

  return (
    <>
      <PageHeader title="Audits" back={<DataBack />} subtitle="Values that passed every check, sampled against their documents. Passing is not the same as right." />
      {byFamily.size === 0 ? (
        <Panel title="Check families">
          <Empty>No audit has run yet. The weekly run samples one family at a time.</Empty>
        </Panel>
      ) : (
        <div className="space-y-5">
          {[...byFamily.entries()].map(([family, [latest, ...earlier]]) => (
            <Panel key={family} title={family} aside={<StatusChip label={`${pct(latest.rate)} wrong`} tone={latest.rate > ISSUE_RATE ? "danger" : "good"} />}>
              <p className="mb-3 text-sm text-muted-foreground">
                {latest.wrong.length} wrong of {latest.checked} checked · {dayLabel(latest.created)} · run {latest.run}
                {earlier.length ? ` · before: ${earlier.map((a) => `${pct(a.rate)} (${dayLabel(a.created)})`).join(", ")}` : ""}
              </p>
              {latest.wrong.length ? <ProposalRowsTable rows={latest.wrong} names={names} caption={`Values in the ${family} sample the documents disagree with`} /> : <Empty>Every sampled value matched its document.</Empty>}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
