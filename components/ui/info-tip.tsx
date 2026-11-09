import type { ComponentProps } from "react";
import { asCiteRef } from "@/lib/cite-origin";
import type { CiteLike } from "@/lib/lineage";
import { InfoTip as InfoTipClient, MetricLabel as MetricLabelClient, SourceTip as SourceTipClient, Term as TermClient } from "./info-tip-client";

/**
 * The ⓘ components (components/ui/info-tip-client.tsx), each behind a wrapper that hands a dataset citation on as a
 * reference the popover fetches when it opens (lib/cite-origin.ts `asCiteRef`; round 5, U3, specs/data-lineage.md
 * "Citations on the plan"). No "use client" here: rendered by a server component, the wrapper runs on the server and only
 * the reference enters the page's payload; imported by a client component, it is an ordinary function and passes the
 * citation through (nothing on the client is marked). Same markup either way: the wrapper renders nothing of its own.
 */

export { SourceLink, SourcesTip, loadCite, useCite, type CiteState, type SourceGroup } from "./info-tip-client";

/** The `cited` prop as a reference where it can be one; absent stays absent (no `"$undefined"` in the payload). */
function citedProp(cited: CiteLike | undefined): { cited?: CiteLike } {
  return cited === undefined ? {} : { cited: asCiteRef(cited) };
}

/** Small (i) icon that explains a term on hover, focus, or tap; with `cited`, also where the value came from. */
export function InfoTip({ cited, ...props }: ComponentProps<typeof InfoTipClient>) {
  return <InfoTipClient {...props} {...citedProp(cited)} />;
}

/** Source-only (i) icon, for values without a glossary term. */
export function SourceTip({ cited, ...props }: ComponentProps<typeof SourceTipClient>) {
  return <SourceTipClient {...props} cited={asCiteRef(cited)} />;
}

/** Inline word with a dotted underline that opens the same explanation. */
export function Term({ cited, ...props }: ComponentProps<typeof TermClient>) {
  return <TermClient {...props} {...citedProp(cited)} />;
}

/** Label + info icon, the standard way to title any metric (`cited` from `citeField`, or a `CiteRef`). */
export function MetricLabel({ cited, ...props }: ComponentProps<typeof MetricLabelClient>) {
  return <MetricLabelClient {...props} {...citedProp(cited)} />;
}
