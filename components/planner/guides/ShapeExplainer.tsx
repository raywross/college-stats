"use client";

/**
 * "Why this shape" (specs/planner/v3/guides/list-size.md "1. The shape"): a sheet with the advisor consensus in plain
 * words (lib/planner/list-guide.ts SHAPE_EXPLAINER, cited by name) and what each level means (the estimate's own
 * meaning lines, lib/chances/notes.ts, the same ones "How Quad reads your list" shows). Never a percentage. A bottom
 * sheet on phones, a centered card from `sm` (SheetDialog). Telemetry `plan_guide_shape_explained {season}`.
 */
import { useState } from "react";
import { Info } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { Term } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import { STANDING_LEVEL_LABELS, STANDING_LEVELS } from "@/lib/chances/levels";
import { noteText } from "@/lib/chances/notes";
import type { NoteKey } from "@/lib/chances/types";
import { SHAPE_EXPLAINER, SHAPE_EXPLAINER_SOURCES } from "@/lib/planner/list-guide";
import type { Season } from "@/lib/planner/seasons";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { cn } from "@/lib/utils";

export function ShapeExplainer({ season, sentence }: { season: Season; sentence?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          track("plan_guide_shape_explained", { season });
        }}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
      >
        <Info className="size-4" aria-hidden />
        Why this shape
      </button>
      <SheetDialog open={open} onOpenChange={setOpen} title="Why this shape">
        <div className="space-y-5 text-sm">
          {sentence && <p className="text-muted-foreground">{sentence}</p>}
          {SHAPE_EXPLAINER.map((s) => (
            <section key={s.heading} className="space-y-1">
              <h3 className="font-semibold">{s.heading}</h3>
              <p className="text-muted-foreground">{s.text}</p>
            </section>
          ))}
          <section className="space-y-2">
            <h3 className="font-semibold">
              What the <Term term="levels">levels</Term> mean
            </h3>
            <ul className="space-y-2">
              {STANDING_LEVELS.map((l) => (
                <li key={l} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
                  <span className={cn("inline-flex h-6 w-fit shrink-0 items-center rounded-full px-2.5 text-xs font-bold", GROUP_CLASS[l])}>{STANDING_LEVEL_LABELS[l]}</span>
                  <span className="text-muted-foreground">{noteText({ key: `estimate.level.${l}` as NoteKey, values: { test: "" } })}</span>
                </li>
              ))}
            </ul>
          </section>
          <p className="border-t pt-3 text-xs text-muted-foreground">{SHAPE_EXPLAINER_SOURCES}</p>
        </div>
      </SheetDialog>
    </>
  );
}

export default ShapeExplainer;
