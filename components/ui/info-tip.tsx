"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info, ArrowRight } from "lucide-react";
import { GLOSSARY, type TermKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

function TermPopup({ term }: { term: TermKey }) {
  const entry = GLOSSARY[term];
  return (
    <Popover.Portal>
      <Popover.Positioner side="top" sideOffset={8} collisionPadding={12} className="z-[60]">
        <Popover.Popup
          className={cn(
            "w-72 max-w-[calc(100vw-24px)] rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl shadow-black/10 outline-none",
            "origin-(--transform-origin) transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
          )}
        >
          <Popover.Arrow className="data-[side=top]:-bottom-[5px] data-[side=bottom]:-top-[5px]">
            <span className="block size-2.5 rotate-45 border-r border-b bg-popover" />
          </Popover.Arrow>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-pop text-pop-foreground">
              <Info className="size-3" strokeWidth={2.5} />
            </span>
            <Popover.Title className="font-display text-sm font-semibold">{entry.term}</Popover.Title>
          </div>
          <Popover.Description className="text-[13px] leading-relaxed text-muted-foreground">
            {entry.short}
          </Popover.Description>
          <Link
            href={`/glossary#${term}`}
            className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Learn more in the glossary <ArrowRight className="size-3" />
          </Link>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

/** Small (i) icon that explains a term on hover, focus, or tap. */
export function InfoTip({ term, className }: { term: TermKey; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={120}
        closeDelay={120}
        aria-label={`What is ${GLOSSARY[term].term}?`}
        className={cn(
          "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground/80 transition-colors",
          "hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[popup-open]:text-primary",
          "after:absolute after:-inset-2.5 after:content-['']",
          className
        )}
      >
        <Info className="size-3.5" />
      </Popover.Trigger>
      <TermPopup term={term} />
    </Popover.Root>
  );
}

/** Inline word with a dotted underline that opens the same explanation. */
export function Term({ term, children, className }: { term: TermKey; children?: ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={120}
        nativeButton
        className={cn(
          "cursor-help underline decoration-dotted decoration-[1.5px] underline-offset-[3px] decoration-muted-foreground/60 transition-colors",
          "hover:decoration-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[popup-open]:decoration-primary",
          className
        )}
      >
        {children ?? GLOSSARY[term].term}
      </Popover.Trigger>
      <TermPopup term={term} />
    </Popover.Root>
  );
}

/** Label + info icon, the standard way to title any metric. */
export function MetricLabel({
  term,
  children,
  className,
}: {
  term?: TermKey;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      {term && <InfoTip term={term} />}
    </span>
  );
}
