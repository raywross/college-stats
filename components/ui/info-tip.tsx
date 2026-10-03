"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info, ArrowRight, BookMarked, ExternalLink } from "lucide-react";
import { GLOSSARY, type TermKey } from "@/lib/glossary";
import { yearLabel, type Cited, type CitedSource } from "@/lib/lineage";
import { num, pctSmart } from "@/lib/format";
import { cn } from "@/lib/utils";

function SourceLink({ s }: { s: CitedSource }) {
  return (
    <>
      <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-foreground hover:text-primary hover:underline">
        {s.label}
        <ExternalLink className="size-2.5" aria-hidden />
      </a>
      , {yearLabel(s)}
    </>
  );
}

/** Bare link, no trailing year (the year's already in the sentence above it). */
function SourceLinkBare({ s }: { s: CitedSource }) {
  return (
    <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-foreground hover:text-primary hover:underline">
      {s.label}
      <ExternalLink className="size-2.5" aria-hidden />
    </a>
  );
}

/**
 * "in its Common Data Set Fall 2026" / "in its class profile for the Fall 2026 class" / "on its own site", from
 * `cited.sourceKind` (lib/lineage.ts, from `school.reported.admissions.source_kind`) when it's known.
 */
function sourceKindPhrase(cited: Cited): string {
  const year = yearLabel(cited);
  // A CDS record value (round 3): the edition and the year it describes can differ (an aid year, an application cycle).
  if (cited.cdsEdition) return `in its ${cited.cdsEdition} Common Data Set, for ${year}`;
  if (cited.sourceKind === "cds") return `in its Common Data Set ${year}`;
  if (cited.sourceKind === "class-profile") return `in its class profile for the ${year} class`;
  return "on its own site";
}

/** The federal (or previous) value a college-reported value replaced, formatted by field. */
function formatReplaced(cited: Cited): string {
  const value = cited.replaces?.value ?? null;
  if (value === null) return "not reported";
  return cited.path.endsWith("acceptance_rate") ? pctSmart(value) : num(value);
}

/** Where a value came from: source, year, method, formula, inputs, and what it replaced, if anything. */
function SourceBlock({ cited }: { cited: Cited }) {
  const inputs = cited.inputs ?? [];
  const isCollegeSite = cited.key === "college-site";
  return (
    <div className="space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
      <p className="flex items-center gap-1 text-[10px] font-bold tracking-[0.14em] text-foreground/70 uppercase">
        <BookMarked className="size-3" aria-hidden /> Source
      </p>
      {cited.method === "derived" && inputs.length > 0 ? (
        <p>
          Calculated: {cited.formula}. From{" "}
          {inputs.map((s, i) => (
            <span key={`${s.key}${s.url}${s.year}`}>
              <SourceLink s={s} />
              {i < inputs.length - 1 ? "; " : ""}
            </span>
          ))}
          .
        </p>
      ) : isCollegeSite ? (
        <p>
          Reported by {cited.publisher} {sourceKindPhrase(cited)}.
        </p>
      ) : (
        <p>
          {cited.method === "extracted" ? "Read from " : "Reported in "}
          <SourceLink s={cited} />
          {cited.page !== undefined && `, p. ${cited.page}`}.{cited.formula && ` ${cited.formula}.`}
        </p>
      )}
      {cited.quote && <blockquote className="border-l-2 pl-2 italic">“{cited.quote}”</blockquote>}
      {isCollegeSite && (
        <p>
          <SourceLinkBare s={cited} />
          {cited.page !== undefined && `, p. ${cited.page}`}.
        </p>
      )}
      {cited.replaces && (
        <p className="font-medium text-foreground">
          {cited.replaces.label ?? "Federal data"}, {cited.replaces.year ?? "most recent release"}: {cited.replaces.display ?? formatReplaced(cited)}
        </p>
      )}
      <p className="text-[11px]">Retrieved {cited.retrieved}</p>
    </div>
  );
}

function Popup({ title, children }: { title: ReactNode; children: ReactNode }) {
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
            <Popover.Title className="font-display text-sm font-semibold">{title}</Popover.Title>
          </div>
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

function TermPopup({ term, cited }: { term: TermKey; cited?: Cited }) {
  const entry = GLOSSARY[term];
  return (
    <Popup title={entry.term}>
      <Popover.Description className="text-[13px] leading-relaxed text-muted-foreground">{entry.short}</Popover.Description>
      <Link href={`/glossary#${term}`} className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
        Learn more in the glossary <ArrowRight className="size-3" />
      </Link>
      {cited && (
        <div className="mt-3 border-t pt-3">
          <SourceBlock cited={cited} />
        </div>
      )}
    </Popup>
  );
}

const triggerClass = cn(
  "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground/80 transition-colors",
  "hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[popup-open]:text-primary",
  "after:absolute after:-inset-2.5 after:content-['']"
);

/**
 * Small (i) icon that explains a term on hover, focus, or tap. With `cited`, the
 * same popover also says where this value came from (see specs/data-lineage.md).
 */
export function InfoTip({ term, cited, className }: { term: TermKey; cited?: Cited; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={120}
        closeDelay={120}
        aria-label={cited ? `What is ${GLOSSARY[term].term}, and where it comes from` : `What is ${GLOSSARY[term].term}?`}
        className={cn(triggerClass, className)}
      >
        <Info className="size-3.5" />
      </Popover.Trigger>
      <TermPopup term={term} cited={cited} />
    </Popover.Root>
  );
}

/** Source-only (i) icon, for values without a glossary term. */
export function SourceTip({ cited, className }: { cited: Cited; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={120} closeDelay={120} aria-label={`Source for ${cited.field}`} className={cn(triggerClass, className)}>
        <BookMarked className="size-3" />
      </Popover.Trigger>
      <Popup title={cited.field}>
        <SourceBlock cited={cited} />
      </Popup>
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

/**
 * Label + info icon, the standard way to title any metric. Pass `cited` (from
 * `citeField`) so the popover shows the value's source and year.
 */
export function MetricLabel({
  term,
  cited,
  children,
  className,
}: {
  term?: TermKey;
  cited?: Cited;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      {term ? <InfoTip term={term} cited={cited} /> : cited && <SourceTip cited={cited} />}
    </span>
  );
}
