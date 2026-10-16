"use client";

/**
 * "How this season works" (specs/planner/next-steps/seasons.md "The Next steps tab" "Header"): a sheet with the
 * season's playbook as a paragraph (the catalog's `SEASON_EXPLAINER`), and for juniors and seniors a line on what
 * counts next season. Plan v3 (now.md "The tab"): that next-season line is kept on purpose, the one place a student
 * sees ahead now that Coming up is the parent's. Opened and closed by the caller (NextSteps.tsx), which also fires
 * `plan_season_explainer_opened`.
 */
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { SEASON_EXPLAINER } from "@/lib/planner/moves-catalog";
import type { Season } from "@/lib/planner/seasons";

export function SeasonExplainer({ open, onOpenChange, season }: { open: boolean; onOpenChange: (open: boolean) => void; season: Season }) {
  const info = SEASON_EXPLAINER[season];
  return (
    <SheetDialog open={open} onOpenChange={onOpenChange} title="How this season works" description={info.lead}>
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>{info.paragraph}</p>
        {info.next && <p className="font-semibold text-foreground">{info.next}</p>}
      </div>
    </SheetDialog>
  );
}

export default SeasonExplainer;
