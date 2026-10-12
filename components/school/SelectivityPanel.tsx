"use client";

import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { ArrowRight, Info } from "lucide-react";
import type { AnyCited } from "@/lib/lineage";
import { SourceLink } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** One published figure the panel lists, already worded on the server, with its citation. */
export interface PanelFact {
  label: string;
  value: string;
  note?: string;
  cited: AnyCited;
}

/** The sentence every panel ends on (specs/chances/selectivity-index.md "Where it shows"). */
export const SELECTIVITY_DISCLAIMER = "Quad's selectivity is our own reading of these published figures; it isn't a ranking and it says nothing about quality or fit.";

/**
 * The selectivity chip's ⓘ: "How Quad reads {College}'s selectivity", the figures it reads as cited facts (value, source,
 * year), and the disclaimer. Facts only: the weights, the index, and the cutoffs never reach this component.
 */
export function SelectivityPanel({ college, facts, className }: { college: string; facts: PanelFact[]; className?: string }) {
  return (
    <Popover.Root onOpenChange={(open) => open && track("term_opened", { term: "selectivity-tier" })}>
      <Popover.Trigger
        openOnHover
        delay={120}
        closeDelay={120}
        aria-label={`How Quad reads ${college}'s selectivity`}
        className={cn(
          "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground/80 transition-colors",
          "hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[popup-open]:text-primary",
          "after:absolute after:-inset-2.5 after:content-['']",
          className
        )}
      >
        <Info className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} collisionPadding={12} className="z-[60]">
          <Popover.Popup
            className={cn(
              "max-h-[min(32rem,calc(100vh-48px))] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl shadow-black/10 outline-none",
              "origin-(--transform-origin) transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
            )}
          >
            <div className="mb-2 flex items-start gap-2">
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-pop text-pop-foreground">
                <Info className="size-3" strokeWidth={2.5} />
              </span>
              <Popover.Title className="font-display text-sm font-semibold">How Quad reads {college}&apos;s selectivity</Popover.Title>
            </div>
            {facts.length > 0 && (
              <ul className="space-y-2 border-b pb-3">
                {facts.map((f, i) => (
                  <li key={`${f.cited.path}-${i}`} className="text-[12px] leading-snug">
                    <p>
                      <span className="text-muted-foreground">{f.label}</span> <span className="font-bold text-foreground tabular-nums">{f.value}</span>
                      {f.note && <span className="text-muted-foreground"> {f.note}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      <SourceLink s={f.cited} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Popover.Description className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{SELECTIVITY_DISCLAIMER}</Popover.Description>
            <Link href="/glossary#selectivity-tier" className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              Learn more in the glossary <ArrowRight className="size-3" />
            </Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
