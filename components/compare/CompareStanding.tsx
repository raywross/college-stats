"use client";

import { useEffect, useState } from "react";
import { StandingBadge } from "@/components/chances/StandingBadge";
import { InfoTip } from "@/components/ui/info-tip";
import { SLOT_COLORS } from "@/lib/brand";
import { noteText } from "@/lib/chances/notes";
import { myStandingInput } from "@/lib/chances/standing-store";
import { rateKindText } from "@/lib/chances/what-went-in";
import type { EstimateResult } from "@/lib/chances/types";
import { cn } from "@/lib/utils";

/**
 * Compare's "Where you stand" row (specs/product/chances-and-fit.md "Display", specs/chances/base-rates.md "Where it
 * shows"): Quad's estimate for each compared college, with the rate it started from named under it ("in-state rate",
 * "guaranteed"). Only for a signed-in student with numbers; Compare's page is public and static, so the student's
 * numbers and the estimates arrive after mount (like the "You" score row) and the block is absent until then.
 */
export function CompareStanding({ colleges, className }: { colleges: { id: string; name: string }[]; className?: string }) {
  const [results, setResults] = useState<Record<string, EstimateResult> | null>(null);
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
      if (!cancelled) setResults(body.results ?? null);
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
          const rate = r ? rateKindText(r) : null;
          return (
            <li key={c.id} className="grid grid-cols-[4.5rem_1fr] items-start gap-3 sm:grid-cols-[6rem_1fr]">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} aria-hidden />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                {r?.group ? <StandingBadge result={r} /> : <span className="text-sm text-muted-foreground">{noteText({ key: "estimate.compare_none", values: {} })}</span>}
                {r?.group && rate && <span className="text-xs text-muted-foreground">{rate}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">{noteText({ key: "estimate.label", values: {} })}. It is our own assessment, not a prediction from any college.</p>
    </div>
  );
}
