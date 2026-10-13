"use client";

import { useEffect, useState } from "react";
import { ComparedWithTip } from "@/components/chances/ComparedWith";
import { StandingBadge } from "@/components/chances/StandingBadge";
import { InfoTip } from "@/components/ui/info-tip";
import { SLOT_COLORS } from "@/lib/brand";
import { comparedWith } from "@/lib/chances/compared-with";
import { noteText } from "@/lib/chances/notes";
import type { PoolSchool } from "@/lib/chances/pool-rate";
import { myStandingInput } from "@/lib/chances/standing-store";
import { compareShortLine } from "@/lib/chances/what-went-in";
import type { EstimateResult, EstimateStudent } from "@/lib/chances/types";
import type { AnyCited } from "@/lib/lineage";
import { cn } from "@/lib/utils";

/**
 * Compare's "Where you stand" row (specs/product/chances-and-fit.md "Display", specs/chances/pool-explainer.md
 * "Where it shows"): Quad's estimate for each compared college, with the sentence's short form under it ("from
 * Indiana: 71%", "everyone: 43%", "guaranteed") and the same "Who you're compared with" panel the stage-2 sentence
 * opens elsewhere. Only for a signed-in student with numbers; Compare's page is public and static, so the student's
 * numbers and the estimates arrive after mount (like the "You" score row) and the block is absent until then.
 */
export function CompareStanding({
  colleges,
  poolSchools,
  cites,
  className,
}: {
  colleges: { id: string; name: string }[];
  /** The college's own published rates, for the panel (pool-explainer.md). */
  poolSchools: Record<string, PoolSchool>;
  /** Citations for every field the panel can cite, resolved on the server (lib/chances/fact-cites.ts). */
  cites: Record<string, Record<string, AnyCited>>;
  className?: string;
}) {
  const [results, setResults] = useState<Record<string, EstimateResult> | null>(null);
  const [student, setStudent] = useState<EstimateStudent | null>(null);
  const idKey = colleges.map((c) => c.id).join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mine = await myStandingInput().catch(() => null);
      if (!mine || !mine.signedIn || !mine.hasNumbers) return;
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student: mine.student, unitIds: idKey.split(","), context: mine.context }),
      });
      if (!res.ok || cancelled) return;
      const body = (await res.json()) as { results?: Record<string, EstimateResult> };
      if (!cancelled) {
        setResults(body.results ?? null);
        setStudent(mine.student);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [idKey]);

  if (!results) return null;
  return (
    // The frame of profile/Panel's Block, written out: that module is a server component and can't be imported here.
    <div id="standing" className={cn("rounded-3xl border bg-card p-4 sm:p-6", className)}>
      <h3 className="mb-4 flex items-center gap-1 font-display text-lg font-bold">
        {noteText({ key: "estimate.card_title", values: {} })} <InfoTip term="quads-estimate" />
      </h3>
      <ul className="space-y-3">
        {colleges.map((c, i) => {
          const r = results[c.id];
          const short = r ? compareShortLine(r) : null;
          const poolSchool = poolSchools[c.id];
          const compared = r && student && poolSchool ? comparedWith({ state: student.state, classRankPercentile: student.classRankPercentile, gpa: student.gpa, majors: student.majors, round: student.round }, poolSchool) : null;
          return (
            <li key={c.id} className="grid grid-cols-[4.5rem_1fr] items-start gap-3 sm:grid-cols-[6rem_1fr]">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} aria-hidden />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                {r?.group ? <StandingBadge result={r} /> : <span className="text-sm text-muted-foreground">{noteText({ key: "estimate.compare_none", values: {} })}</span>}
                {r?.group && short && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {short}
                    {compared && <ComparedWithTip data={compared} cite={(p) => cites[c.id]?.[p]} />}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">{noteText({ key: "estimate.label", values: {} })}. It is our own assessment, not a prediction from any college.</p>
    </div>
  );
}
