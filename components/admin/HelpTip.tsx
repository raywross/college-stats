"use client";

import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { ArrowRight, Info } from "lucide-react";
import { helpEntry, type HelpKey } from "@/lib/admin/help";
import { cn } from "@/lib/utils";

/**
 * The console's (i) icon (specs/product/admin-redesign.md "Info icons and the Help page"): beside a panel's or a page's
 * title, or a status chip, it explains the word from the console's glossary (lib/admin/help.ts) on hover, focus, or
 * tap: the entry's title, its two or three sentences, "What you can do here", and "More" to /admin/help#<key>. Built
 * like the site's InfoTip (components/ui/info-tip.tsx) on the base-ui Popover; the icon is small and its hit area is
 * 44 px. No analytics: nothing is tracked under /admin.
 */
export function HelpTip({ help, className }: { help: HelpKey; className?: string }) {
  const entry = helpEntry(help);
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={120}
        closeDelay={120}
        aria-label={`What is ${entry.title}?`}
        className={cn(
          "relative inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground/80 transition-colors",
          "hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[popup-open]:text-primary",
          // A 44px hit area around the 20px icon (specs/mobile.md: every control 44px).
          "after:absolute after:-inset-3 after:content-['']",
          className,
        )}
      >
        <Info className="size-4" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} collisionPadding={12} className="z-[60]">
          <Popover.Popup
            className={cn(
              "w-80 max-w-[calc(100vw-24px)] rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl shadow-black/10 outline-none",
              "origin-(--transform-origin) transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            )}
          >
            <Popover.Arrow className="data-[side=top]:-bottom-[5px] data-[side=bottom]:-top-[5px]">
              <span className="block size-2.5 rotate-45 border-r border-b bg-popover" />
            </Popover.Arrow>
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-pop text-pop-foreground">
                <Info className="size-3" strokeWidth={2.5} aria-hidden />
              </span>
              <Popover.Title className="font-display text-sm font-semibold">{entry.title}</Popover.Title>
            </div>
            <Popover.Description className="text-[13px] leading-relaxed text-muted-foreground">{entry.short}</Popover.Description>
            {entry.do && (
              <p className="mt-2 text-[13px] leading-relaxed">
                <span className="font-semibold">What you can do here: </span>
                {entry.do}
              </p>
            )}
            <Link href={`/admin/help#${help}`} className="mt-2.5 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary hover:underline">
              More <ArrowRight className="size-3" aria-hidden />
            </Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
