import Link from "next/link";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";
import { noteText } from "@/lib/chances/notes";
import { panelParts, uncoveredFacts, yourNumbersList, type YourNumbers } from "@/lib/chances/what-went-in";
import type { EstimateResult } from "@/lib/chances/types";
import type { AnyCited } from "@/lib/lineage";
import { cn } from "@/lib/utils";

/**
 * "What went into this estimate" (specs/chances/estimate.md "What families see"): like Zillow's "what affects the
 * Zestimate", the kinds of input the estimate used and the facts it looked at, without saying how they were combined.
 * It shows the student's own entries (only the kinds the estimate used), the college's facts as the catalog's
 * sentences each with its source, what the college doesn't weigh, one prompt for the input that could change the
 * result, and the standing disclaimer. Every sentence is `noteText` of a result note; nothing is composed here from
 * a number, so the panel can say no more than the catalog allows.
 *
 * `cite` resolves a field path to its citation (the college page resolves them on the server, the planner with the
 * plan's schools); a path it can't resolve shows its sentence without an (i).
 */
export function WhatWentIn({
  result,
  yours,
  college,
  cite,
  promptHref,
  className,
}: {
  result: EstimateResult;
  /** The student's entries as words; null when the viewer's numbers aren't at hand (a guardian's copy shows none). */
  yours: YourNumbers | null;
  college: string;
  cite: (path: string) => AnyCited | undefined;
  /** Where "Adding your … could change this estimate" can be acted on (the profile), when the viewer can. */
  promptHref?: string;
  className?: string;
}) {
  const parts = panelParts(result);
  const list = yours ? yourNumbersList(yours, result.used) : [];
  const also = uncoveredFacts(result);
  return (
    <section aria-label={noteText({ key: "estimate.panel_title", values: {} })} className={cn("space-y-2.5 text-sm", className)}>
      <h4 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{noteText({ key: "estimate.panel_title", values: {} })}</h4>
      {list.length > 0 && <p>{noteText({ key: "estimate.your_numbers", values: { list: list.join(" · ") } })}</p>}
      {(parts.reasons.length > 0 || also.length > 0) && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">{noteText({ key: "estimate.panel_college", values: { college } })}</p>
          <ul className="mt-1 space-y-1">
            {parts.reasons.map((n, i) => {
              const cited = n.cite ? cite(n.cite) : undefined;
              return (
                <li key={`${n.key}-${i}`}>
                  {noteText(n)}
                  {cited && <SourceTip cited={cited} className="ml-1 align-middle" />}
                </li>
              );
            })}
          </ul>
          {also.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              {noteText({ key: "estimate.panel_also", values: {} })}:{" "}
              {also.map((f, i) => {
                const cited = cite(f.path);
                return (
                  <span key={f.path}>
                    {i > 0 && " · "}
                    {f.label}
                    {cited && <SourceTip cited={cited} className="ml-1 align-middle" />}
                  </span>
                );
              })}
            </p>
          )}
        </div>
      )}
      {parts.notUsed.length > 0 && (
        <ul className="space-y-1 text-muted-foreground">
          {parts.notUsed.map((n, i) => {
            const cited = n.cite ? cite(n.cite) : undefined;
            return (
              <li key={`${n.key}-${i}`}>
                {noteText(n)}
                {cited && <SourceTip cited={cited} className="ml-1 align-middle" />}
              </li>
            );
          })}
        </ul>
      )}
      {parts.prompt && (
        <p className="font-medium">
          {noteText(parts.prompt)}
          {promptHref && (
            <>
              {" "}
              <Link href={promptHref} className="font-semibold text-primary hover:underline">
                Add it
              </Link>
            </>
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground italic">
        {noteText({ key: "estimate.disclaimer", values: { college } })} <InfoTip term="quads-estimate" className="align-middle not-italic" />
      </p>
    </section>
  );
}
