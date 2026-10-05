import type { ReactNode } from "react";

/** One card on /account (and other account pages): a heading, an optional line under it, and its content. */
export function AccountSection({ id, title, description, children }: { id?: string; title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border bg-card p-4 sm:p-6">
      <h2 className="font-display text-xl font-bold sm:text-2xl">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

/** "Coming soon" body for a section whose feature isn't built yet. */
export function ComingSoon({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground">{children}</p>;
}
