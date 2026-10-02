import type { ReactNode } from "react";
import { DOMAINS, type Domain } from "@/lib/metrics";
import type { FieldPath } from "@/lib/fields";
import type { School } from "@/lib/types";
import { SourceNote } from "@/components/sources/SourceNote";
import { SourceExceptions } from "./SourceExceptions";
import { cn } from "@/lib/utils";

/** Blocks with ids land below the site header and the topic pages' sticky band when linked to. */
export const BLOCK_SCROLL = "scroll-mt-[calc(env(safe-area-inset-top,0px)+var(--header-h)+6.5rem)]";

/**
 * A profile section: eyebrow with its domain color, title, the takeaway sentence, an optional "since" line
 * (HeadlineDelta), the notice for values from a non-default source, the content, and its source footnote.
 * `level` 1 is a topic page's header (h1, no footnote: the page closes with its own); 2 is a section within a page.
 */
export function Panel({
  id,
  level = 2,
  domain,
  eyebrow,
  title,
  takeaway,
  children,
  school,
  fields,
  delta,
  className,
}: {
  id?: string;
  level?: 1 | 2;
  domain?: Domain | null;
  eyebrow: string;
  title: string;
  takeaway?: string;
  /** A "since" line under the takeaway (HeadlineDelta). */
  delta?: ReactNode;
  children: ReactNode;
  school?: School;
  /** Values this section shows (registered paths); their sources close the section. Required so nothing goes uncited. */
  fields: readonly FieldPath[];
  className?: string;
}) {
  const color = domain ? DOMAINS[domain].color : "var(--primary)";
  const Title = level === 1 ? "h1" : "h2";
  return (
    <section id={id} className={cn(BLOCK_SCROLL, className)}>
      <p className="mb-1.5 flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase" style={{ color }}>
        <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-foreground/70">{eyebrow}</span>
      </p>
      <Title className={cn("font-display font-extrabold tracking-tight", level === 1 ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl")}>{title}</Title>
      {takeaway && <p className="mt-2 max-w-3xl text-base text-muted-foreground sm:text-lg">{takeaway}</p>}
      {delta}
      {school && <SourceExceptions fields={fields} school={school} />}
      <div className="mt-5 sm:mt-6">{children}</div>
      {level === 2 && school && fields.length > 0 && <SourceNote fields={fields} school={school} className="mt-4" />}
    </section>
  );
}

/** A dashed placeholder where a block would be, naming what the college doesn't report. */
export function NotReported({ what }: { what: string }) {
  return <div className="rounded-3xl border border-dashed p-6 text-sm text-muted-foreground">{what} isn&apos;t reported for this college.</div>;
}

/** A card with an h3, for the "On this page" list to point at. */
export function Block({ id, title, children, className }: { id?: string; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div id={id} className={cn("rounded-3xl border bg-card p-4 sm:p-6", id && BLOCK_SCROLL, className)}>
      {title && <h3 className="mb-4 flex items-center gap-1 font-display text-lg font-bold">{title}</h3>}
      {children}
    </div>
  );
}
