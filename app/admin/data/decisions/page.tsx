import type { Metadata } from "next";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { DataBack } from "@/components/admin/steward/Bits";
import { decideAction } from "@/app/admin/data/steward-actions";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readDecisions } from "@/lib/admin/steward-reads";
import { dayLabel } from "@/lib/admin/ops-view";

export const metadata: Metadata = { title: "Decisions", robots: { index: false, follow: false } };

/**
 * `/admin/data/decisions` (specs/product/data-steward.md "Four kinds of issue", Policy): the questions only the owner
 * answers, unanswered first, each with the Steward's recommendation and what each answer changes; Decide records one
 * answer with a note (deciding again records the new one).
 */
export default async function DecisionsPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const decisions = await readDecisions(supabase as unknown as StoreClient);
  const open = decisions.filter((d) => d.answer === null).length;

  return (
    <>
      <PageHeader title="Decisions" back={<DataBack />} subtitle="Choices only you make, often for many colleges at once. The Steward follows the answer." />
      {decisions.length === 0 ? (
        <Panel title="Questions">
          <Empty>No questions yet.</Empty>
        </Panel>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground" role="status">
            {open} waiting for an answer
          </p>
          {decisions.map((d) => (
            <Panel key={d.key} title={d.question} aside={d.answer ? <StatusChip label="Decided" tone="good" /> : <StatusChip label="Your call" tone="warn" />}>
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-semibold">Recommends:</span> {d.recommends}
                </p>
                <ul className="space-y-1.5">
                  {d.options.map((o) => (
                    <li key={o.answer} className={`rounded-xl border p-2.5 ${d.answer === o.answer ? "border-primary" : "border-border"}`}>
                      <span className="font-semibold">{o.answer}</span>
                      {d.answer === o.answer ? <span className="text-muted-foreground"> · your answer</span> : null}
                      <span className="block text-muted-foreground">{o.effect}</span>
                    </li>
                  ))}
                </ul>
                {d.answer && (
                  <p className="text-xs text-muted-foreground">
                    Decided {dayLabel(d.decided_at)}
                    {d.decided_by ? ` by ${d.decided_by}` : ""}
                    {d.note ? `: ${d.note}` : ""}
                  </p>
                )}
                <AdminForm
                  action={decideAction}
                  hidden={{ decision: d.key }}
                  trigger={d.answer ? "Decide again" : "Decide"}
                  tone={d.answer ? "default" : "primary"}
                  pendingLabel="Saving…"
                  fields={[
                    { name: "answer", label: "Answer", type: "select", options: d.options.map((o) => ({ value: o.answer, label: o.answer })), defaultValue: d.answer ?? d.options[0]?.answer },
                    { name: "note", label: "Note (optional)", type: "textarea", maxLength: 500 },
                  ]}
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
