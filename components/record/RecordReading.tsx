"use client";

/**
 * "How Quad reads your record right now" (specs/planner/record/reading.md): one section under "How complete is
 * this" on the record overview, reading the estimate back to the student — what it's working from, the one input
 * that would help most, and today's list in level counts. A server-computable section (the overview around it is a
 * server component), but it needs the sheet dialog's open state, so it's a client component the way `ListExplainer`
 * is: `RecordOverview` passes it already-computed props (`PlanLoad`'s `ctx` isn't serializable as-is, so it passes
 * the profile and the plan load's `kind`/`ctx` pieces it needs).
 *
 * Inputs and outputs only, like every estimate surface: this file owns every fixed word (the labels, the two empty
 * states' copy, the links); `lib/planner/record-reading.ts` supplies only the lines a result set can vary, so no
 * number from the estimate ever reaches a string here.
 */
import { useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { RecordReadingShown } from "@/components/record/RecordReadingShown";
import { track } from "@/lib/analytics";
import { estimateInputFromProfile } from "@/lib/chances/estimate-input";
import { noteText } from "@/lib/chances/notes";
import type { EstimateResult } from "@/lib/chances/types";
import { yourNumbersFrom, yourNumbersList } from "@/lib/chances/what-went-in";
import { guideHref } from "@/lib/planner/guides";
import { readingLines, usedInputKinds, usedInputsCount } from "@/lib/planner/record-reading";
import { recordHref, SECTION_RECORD_STEP } from "@/lib/planner/record";
import { planGpaLabel, type StudentProfileData } from "@/lib/student-profile";

export function RecordReading({
  person,
  canEdit,
  profileData,
  estimates,
  items,
}: {
  /** The student's id for a guardian's links, null for the student's own. */
  person: string | null;
  canEdit: boolean;
  profileData: StudentProfileData | null;
  /** The plan's estimates by unit id (ctx.estimates); {} without a ready plan. */
  estimates: Record<string, EstimateResult>;
  /** The plan's rows (ctx.items); [] without a ready plan. */
  items: readonly { unit_id: string; withdrawn_on: string | null }[];
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const student = estimateInputFromProfile(profileData, "", null).student;
  const lines = readingLines({ estimates, items, profile: profileData, student });
  const inputs = usedInputsCount(estimates);

  return (
    <div className="mt-5 border-t pt-4">
      <RecordReadingShown inputs={inputs} missing={lines.notYet !== null} />
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">How Quad reads your record right now</h4>
        {lines.empty === null && (
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="What went into this estimate"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary"
          >
            <Info className="size-4" />
          </button>
        )}
      </div>

      {lines.empty === "no_record" ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Quad needs your grades and a test choice to read your record.
          {canEdit && (
            <>
              {" "}
              <Link href={recordHref({ person, step: 0, back: "record" })} className="font-semibold text-primary hover:underline">
                Fill it in
              </Link>
            </>
          )}
        </p>
      ) : lines.empty === "no_list" ? (
        <p className="mt-2 text-sm text-muted-foreground">Add a college and Quad sorts it as you go.</p>
      ) : (
        <div className="mt-2 space-y-1.5 text-sm">
          {lines.workingFrom && (
            <p>
              <span className="font-semibold">Working from:</span> <span className="text-muted-foreground">{lines.workingFrom}</span>
            </p>
          )}
          {lines.notYet && (
            <p>
              <span className="font-semibold">Not yet:</span> <span className="text-muted-foreground">{lines.notYet.text}</span>
              {canEdit && (
                <>
                  {" "}
                  <Link
                    href={recordHref({ person, step: SECTION_RECORD_STEP[lines.notYet.section], back: "record" })}
                    className="font-semibold text-primary hover:underline"
                  >
                    Add it
                  </Link>
                </>
              )}
            </p>
          )}
          {lines.listLine && (
            <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span>
                <span className="font-semibold">Your list today:</span> <span className="text-muted-foreground">{lines.listLine}.</span>
              </span>
              <Link
                href={guideHref("list", { person, from: "profile" })}
                onClick={() => track("plan_guide_opened", { slug: "list", from: "profile" })}
                className="shrink-0 font-semibold text-primary hover:underline"
              >
                Build your list →
              </Link>
            </p>
          )}
        </div>
      )}

      <SheetDialog open={infoOpen} onOpenChange={setInfoOpen} title={noteText({ key: "estimate.panel_title", values: {} })}>
        <WhatWentInKinds profileData={profileData} estimates={estimates} />
      </SheetDialog>
    </div>
  );
}

/** The sheet's one line: "Your numbers: GPA 3.85 · SAT 1300 · ..." — the same kinds-of-input sentence
 * `WhatWentIn.tsx` shows per college, built from the union every listed college's estimate used. Kinds of inputs
 * only, never a weight (reading.md "Rules"). */
function WhatWentInKinds({ profileData, estimates }: { profileData: StudentProfileData | null; estimates: Record<string, EstimateResult> }) {
  const student = estimateInputFromProfile(profileData, "", null).student;
  const numbers = yourNumbersFrom(student, planGpaLabel(profileData));
  const kinds = usedInputKinds(Object.values(estimates));
  const list = yourNumbersList(numbers, kinds);
  if (list.length === 0) return <p className="text-sm text-muted-foreground">Add your grades or a test score, and Quad starts reading your record.</p>;
  return <p className="text-sm">{noteText({ key: "estimate.your_numbers", values: { list: list.join(" · ") } })}</p>;
}
