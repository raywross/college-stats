import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A titled card on a console page. */
export function Panel({ title, id, aside, children, className }: { title: string; id?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-24 rounded-2xl border bg-card p-4 sm:p-5", className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id ? `${id}-title` : undefined} className="font-display text-lg font-bold tracking-tight">
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Label and value pairs; stacked on phones, two columns from `sm`. */
export function Fields({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{i.label}</dt>
          <dd className="mt-0.5 break-words">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/** A line saying there is nothing here. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** A page's title row. */
export function PageHeader({ title, subtitle, chips, back }: { title: string; subtitle?: ReactNode; chips?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-5 space-y-1">
      {back && <div className="text-sm">{back}</div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="font-display text-2xl font-extrabold tracking-tight break-words sm:text-3xl">{title}</h1>
        {chips}
      </div>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </header>
  );
}

/** Scalar values as text, anything nested as compact JSON (snapshots and plan rows are shown as stored). */
export function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return <Empty>Nothing saved.</Empty>;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,14rem)_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
          <dd className="font-mono text-[13px] break-words">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
