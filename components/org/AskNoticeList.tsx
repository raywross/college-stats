import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { HouseholdActionButton } from "@/components/account/HouseholdActionButton";
import { completeAsk } from "@/app/org/actions";
import { askSentence, isRecordSection } from "@/lib/org-caseload";
import type { OpenOrgAsk } from "@/lib/org-rules";
import { SECTION_STEP } from "@/lib/planner/profile-progress";
import { planHref } from "@/lib/planner/plan-tabs";
import { recordHref } from "@/lib/planner/record";

/** Where an ask's link goes: the record's step for a section, the list for "add your first colleges"; a custom ask has none. */
export function askHref(ask: Pick<OpenOrgAsk, "kind" | "section">, person: string | null): string | null {
  if (ask.kind === "record_section" && isRecordSection(ask.section)) return recordHref({ person, step: SECTION_STEP[ask.section], back: "plan" });
  if (ask.kind === "list") return planHref({ person, tab: "colleges" });
  return null;
}

/**
 * The asks at the top of Next steps (specs/product/counselor-portal.md "Asking a student for something"): "Ms. Rivera
 * asked you to add a test score or target · Add it". A record or list ask links to the step and closes itself once
 * the thing exists (AskNotice checks before rendering); a custom ask has Done. The parent sees the same notice on the
 * student's plan (owner, 2026-10-17: a parent sees the student's view word for word).
 */
export function AskNoticeList({ asks, person, canAct }: { asks: OpenOrgAsk[]; person: string | null; canAct: boolean }) {
  if (asks.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Asks from your counselor">
      {asks.map((a) => {
        const href = askHref(a, person);
        return (
          <li key={a.id} role="note" className="flex flex-col gap-2 rounded-2xl border border-primary/30 bg-primary/8 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="flex min-w-0 items-start gap-2.5">
              <MessageSquareText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 break-words">{askSentence(a)}</span>
            </p>
            {href ? (
              <Link href={href} className="inline-flex h-9 shrink-0 items-center self-start rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground sm:self-auto">
                {a.kind === "list" ? "Add colleges" : "Add it"}
              </Link>
            ) : (
              canAct && <HouseholdActionButton action={completeAsk} fields={{ request: a.id }} label="Done" pendingLabel="Saving…" className="items-start sm:items-end" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
