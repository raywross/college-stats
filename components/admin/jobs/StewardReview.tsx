import { StatusChip } from "@/components/admin/StatusChip";
import type { ChipTone } from "@/lib/admin/console";
import { fmtDateTime } from "@/lib/admin/console";
import { VERDICT_LABEL, repairLine } from "@/lib/steward/job-review";
import type { ReviewDoc, ReviewVerdict } from "@/lib/steward/types";

/** Tone by verdict; the label always says it (tone is never the only signal). */
export const VERDICT_TONE: Readonly<Record<ReviewVerdict, ChipTone>> = { fine: "good", flagged: "warn", failed: "danger" };

/** The Steward's reading as a chip with its help icon. */
export function VerdictChip({ verdict }: { verdict: ReviewVerdict }) {
  return <StatusChip label={VERDICT_LABEL[verdict]} tone={VERDICT_TONE[verdict]} help="verdict" />;
}

/**
 * The Jobs list's Steward cell (specs/product/admin-redesign.md "The screens", Jobs): the verdict chip and the note (or
 * the first reason), the repair when there was one, and which run it read when that isn't the last one.
 */
export function StewardCell({ entry }: { entry: { review: ReviewDoc; ofLastRun: boolean } | null | undefined }) {
  if (!entry) return <span className="text-xs text-muted-foreground">Not reviewed yet</span>;
  const { review, ofLastRun } = entry;
  const line = review.note ?? (review.verdict === "fine" ? null : review.reasons[0]);
  const repair = repairLine(review);
  return (
    <div className="space-y-0.5">
      <VerdictChip verdict={review.verdict} />
      {line && <p className="text-xs">{line}</p>}
      {repair && <p className="text-xs text-muted-foreground">{repair}</p>}
      {!ofLastRun && <p className="text-xs text-muted-foreground">Of an earlier run ({fmtDateTime(review.run_started ?? review.created)}); the last one isn&apos;t reviewed.</p>}
    </div>
  );
}

/** A run page's review: the verdict, the note, every reason, and the repair. */
export function ReviewBody({ review }: { review: ReviewDoc | null }) {
  if (!review) {
    return <p className="text-sm text-muted-foreground">The Steward hasn&apos;t reviewed this run. Runs are reviewed when they finish; the half-hourly collect that finds nothing isn&apos;t.</p>;
  }
  const repair = repairLine(review);
  return (
    <div className="space-y-2 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <VerdictChip verdict={review.verdict} />
        <span className="text-muted-foreground">Reviewed {fmtDateTime(review.created)}</span>
      </p>
      {review.note && <p className="font-medium">{review.note}</p>}
      <ul className="list-disc space-y-1 pl-5">
        {review.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {repair && (
        <p className="flex flex-wrap items-center gap-2">
          <StatusChip label={review.repaired ? "Repaired" : "Not repaired"} tone={review.repaired ? "info" : "neutral"} help="repair" />
          {repair}
        </p>
      )}
    </div>
  );
}
