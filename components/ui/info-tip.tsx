"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info, ArrowRight, BookMarked, ExternalLink } from "lucide-react";
import { GLOSSARY, type TermKey } from "@/lib/glossary";
import { yearLabel, type Cited, type CitedSource } from "@/lib/lineage";
import { num, pctSmart } from "@/lib/format";
import { DEMOGRAPHIC_CATEGORIES } from "@/lib/metrics";
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
  // A CDS record value names its edition, then the year it describes: "in its Common Data Set 2025–26 (fall 2025)".
  if (cited.sourceKind === "cds" && cited.cdsEdition) return `in its Common Data Set ${cited.cdsEdition} (${year.replace(/^(Fall|Entered)\b/, (w) => w.toLowerCase())})`;
  if (cited.sourceKind === "cds") return `in its Common Data Set ${year}`;
  if (cited.sourceKind === "class-profile") return `in its class profile for the ${year} class`;
  return "on its own site";
}

/** The federal (or previous) value a college-reported value replaced, formatted by field. */
function formatReplaced(cited: Cited): string {
  if (cited.replaces?.label) return cited.replaces.label;
  if (cited.replaces?.text) return cited.replaces.text;
  const value = cited.replaces?.value ?? null;
  if (value === null) return "not reported";
  // Race: the seven federal shares in the chart's order; cohort sizes: each group's count.
  if (typeof value === "object") {
    if (cited.path === "demographics.racial_diversity") return DEMOGRAPHIC_CATEGORIES.filter((c) => value[c.key] != null).map((c) => `${c.label} ${pctSmart(value[c.key])}`).join(", ");
    return Object.entries(value).map(([k, v]) => `${k.replace(/_/g, " ")} ${num(v)}`).join(", ");
  }
  return /(acceptance_rate|_share|retention_rate|grad_rate_)/.test(cited.path) ? pctSmart(value) : num(value);
}

/** "Wikimedia Commons" for a Commons file page, else the site's host ("sigep.org"). */
function imageHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return /(^|\.)wikimedia\.org$/.test(host) ? "Wikimedia Commons" : host;
  } catch {
    return "its source";
  }
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
      {cited.directory ? (
        // Someone else's list (owner decision 4, specs/campus-directories.md): credited by name, dated, linked, labeled.
        <p>
          Listed by {cited.directory.organization}
          {cited.publisher !== cited.directory.organization && `, published by ${cited.publisher}`} in <SourceLinkBare s={{ ...cited, label: "its list" }} />, read{" "}
          {cited.retrieved}. This is {cited.directory.phrase}.
        </p>
      ) : cited.method === "derived" && inputs.length > 0 && !(isCollegeSite && cited.sourceKind) ? (
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
          Reported by {cited.publisher} {sourceKindPhrase(cited)}.{cited.method === "derived" && cited.formula && ` Calculated: ${cited.formula}.`}
        </p>
      ) : (
        <p>
          {cited.method === "extracted" ? "Read from " : "Reported in "}
          <SourceLink s={cited} />
          {cited.page !== undefined && `, p. ${cited.page}`}.{cited.formula && ` ${cited.formula}.`}
        </p>
      )}
      {cited.quote && <blockquote className="border-l-2 pl-2 italic">“{cited.quote}”</blockquote>}
      {cited.image && (
        <p className="text-[11px]">
          {cited.image.what}: {cited.image.attribution}, {cited.image.license}, via{" "}
          <SourceLinkBare s={{ ...cited, label: imageHost(cited.image.source), url: cited.image.source }} />.
        </p>
      )}
      {isCollegeSite && (
        <p>
          <SourceLinkBare s={cited} />
          {cited.page !== undefined && `, p. ${cited.page}`}.
        </p>
      )}
      {cited.replaces && (
        <p className="font-medium text-foreground">
          {cited.replaces.label ?? "Federal data"}, {cited.replaces.year?.replace(/^Entered\b/, "entered") ?? "most recent release"}: {cited.replaces.display ?? formatReplaced(cited)}
        </p>
      )}
      {!cited.directory && <p className="text-[11px]">Retrieved {cited.retrieved}</p>}
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
export function Term({ term, children, className, cited }: { term: TermKey; children?: ReactNode; className?: string; cited?: Cited }) {
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
      <TermPopup term={term} cited={cited} />
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
