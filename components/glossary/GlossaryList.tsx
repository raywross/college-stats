"use client";

import { useMemo, useState } from "react";
import { Lightbulb, Search } from "lucide-react";
import { GLOSSARY, isTermKey, termsByCategory, type TermKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  Admissions: "var(--d-admissions)",
  "Test scores": "var(--d-scores)",
  "Students & access": "var(--d-access)",
  "School types": "var(--d-size)",
  "How we measure": "var(--d-diversity)",
  "Data sources": "var(--muted-foreground)",
};

export function GlossaryList() {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    return termsByCategory()
      .map((g) => ({
        ...g,
        terms: g.terms.filter(
          ([, e]) => !query || e.term.toLowerCase().includes(query) || e.short.toLowerCase().includes(query)
        ),
      }))
      .filter((g) => g.terms.length > 0);
  }, [q]);

  return (
    <div className="grid gap-8 lg:grid-cols-[14rem_1fr] lg:gap-12">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <label className="flex h-11 items-center gap-2 rounded-full border bg-card px-4 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/15">
          <Search className="size-4 text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search terms"
            aria-label="Search glossary"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <nav className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto lg:flex-col" aria-label="Categories">
          {groups.map((g) => (
            <a
              key={g.category}
              href={`#cat-${g.category.replace(/\W+/g, "-").toLowerCase()}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[g.category] }} />
              {g.category}
              <span className="ml-auto text-xs font-medium">{g.terms.length}</span>
            </a>
          ))}
        </nav>
      </aside>

      <div className="space-y-12">
        {groups.length === 0 && <p className="text-muted-foreground">No terms match “{q}”.</p>}
        {groups.map((g) => (
          <section key={g.category} id={`cat-${g.category.replace(/\W+/g, "-").toLowerCase()}`} className="scroll-mt-24">
            <h2 className="mb-4 flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
              <span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[g.category] }} />
              {g.category}
            </h2>
            <div className="grid items-start gap-3 md:grid-cols-2">
              {g.terms.map(([key, e]) => (
                <article key={key} id={key} className="term-target scroll-mt-24 rounded-3xl border bg-card p-5">
                  <h3 className="font-display text-lg font-bold">{e.term}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed">{e.short}</p>
                  {e.long && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{e.long}</p>}
                  {e.why && (
                    <div className="mt-3 flex gap-2 rounded-2xl bg-pop/25 p-3 text-sm dark:bg-pop/10">
                      <Lightbulb className="mt-0.5 size-4 shrink-0" />
                      <p>
                        <b>Why it matters:</b> {e.why}
                      </p>
                    </div>
                  )}
                  {e.related && e.related.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Related:</span>
                      {e.related.filter(isTermKey).map((r: TermKey) => (
                        <a
                          key={r}
                          href={`#${r}`}
                          className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold hover:border-primary/40 hover:text-primary")}
                        >
                          {GLOSSARY[r].term}
                        </a>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
