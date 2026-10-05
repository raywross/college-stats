import { Clock } from "lucide-react";

/**
 * A quiet placeholder for a /trends section whose unit hasn't shipped yet (Movers, By conference, By state). The unit
 * that builds the section replaces this component's line in app/trends/page.tsx with its own entry component.
 */
export function ComingSection({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <section aria-labelledby={id} className="rounded-3xl border border-dashed p-5 sm:p-6">
      <h2 id={id} className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-muted-foreground">
        {title}
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-sans text-[11px] font-semibold tracking-normal">
          <Clock className="size-3" aria-hidden /> Coming
        </span>
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
    </section>
  );
}
