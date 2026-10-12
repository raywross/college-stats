"use client";

import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import { SourceTip } from "@/components/ui/info-tip";
import type { ComparedRow, ComparedWith as ComparedWithData } from "@/lib/chances/compared-with";
import { track } from "@/lib/analytics";
import type { AnyCited } from "@/lib/lineage";
import { cn } from "@/lib/utils";

/**
 * "Who you're compared with" (specs/chances/pool-explainer.md "Who you're compared with"): the ⓘ on the stage-2
 * sentence opens this wider panel instead of a single citation — the InfoTip pattern, scaled up for a small table.
 * Every rate is cited; the row that applies to the student is bold and first. Pure display: `data` (from
 * `lib/chances/compared-with.ts`) already carries every word and number, so nothing here can say more than the
 * catalog allows.
 */
export function ComparedWithTip({ data, cite, className }: { data: ComparedWithData; cite: (path: string) => AnyCited | undefined; className?: string }) {
  return (
    <Popover.Root onOpenChange={(open) => open && track("term_opened", { term: "applicants-like-you" })}>
      <Popover.Trigger
        openOnHover
        delay={120}
        closeDelay={120}
        aria-label="Who you're compared with"
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
              "w-[min(26rem,calc(100vw-24px))] rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl shadow-black/10 outline-none",
              "origin-(--transform-origin) transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
            )}
          >
            <Popover.Arrow className="data-[side=top]:-bottom-[5px] data-[side=bottom]:-top-[5px]">
              <span className="block size-2.5 rotate-45 border-r border-b bg-popover" />
            </Popover.Arrow>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-pop text-pop-foreground">
                <Info className="size-3" strokeWidth={2.5} />
              </span>
              <Popover.Title className="font-display text-sm font-semibold">Who you&apos;re compared with</Popover.Title>
            </div>
            <Popover.Description className="text-[13px] leading-relaxed text-muted-foreground">{data.intro}</Popover.Description>
            <table className="mt-3 w-full text-[13px]">
              <tbody>
                {data.rows.map((row, i) => (
                  <ComparedRowLine key={`${row.label}-${i}`} row={row} cite={cite} />
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-muted-foreground italic">
              <Link href="/household" className="font-semibold text-foreground not-italic hover:text-primary hover:underline">
                {data.changeState}
              </Link>
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ComparedRowLine({ row, cite }: { row: ComparedRow; cite: (path: string) => AnyCited | undefined }) {
  const cited = row.cite ? cite(row.cite) : undefined;
  return (
    <tr className={cn("border-t first:border-t-0", row.applies && "font-semibold text-foreground")}>
      <td className="py-1.5 pr-2 align-top">
        {row.label}
        {row.note && (row.rate === null || row.label === "Early decision") && <div className="text-[12px] font-normal text-muted-foreground">{row.note}</div>}
      </td>
      <td className="py-1.5 text-right align-top tabular-nums">
        {row.rate !== null ? (
          <>
            {row.rate}
            {cited && <SourceTip cited={cited} className="ml-1 align-middle" />}
          </>
        ) : row.note ? (
          cited && <SourceTip cited={cited} className="align-middle" />
        ) : null}
      </td>
      <td className="py-1.5 pl-2 text-right align-top text-muted-foreground">{row.year}</td>
    </tr>
  );
}
