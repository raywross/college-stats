"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { helpByDoor, seeHref } from "@/lib/admin/help";

/**
 * /admin/help's list (specs/product/admin-redesign.md "Info icons and the Help page"): every entry of the console's
 * glossary by door, with its long note and what you can do, filtered as you type (like /glossary). Each entry is an
 * anchor (`#<key>`), the target of a HelpTip's "More".
 */
export function HelpList({ repo }: { repo: string }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    return helpByDoor()
      .map((g) => ({
        ...g,
        entries: g.entries.filter(({ entry }) => !query || [entry.title, entry.short, entry.long ?? "", entry.do ?? ""].some((t) => t.toLowerCase().includes(query))),
      }))
      .filter((g) => g.entries.length > 0);
  }, [q]);

  return (
    <div className="space-y-6">
      <label className="flex h-11 items-center gap-2 rounded-full border bg-card px-4 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/15">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the console's words" aria-label="Search help" className="min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm" />
      </label>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">No word matches &ldquo;{q}&rdquo;.</p>}
      {groups.map((g) => (
        <section key={g.door} aria-labelledby={`help-${g.door}`} className="space-y-3">
          <h2 id={`help-${g.door}`} className="font-display text-xl font-bold tracking-tight">
            {g.label}
          </h2>
          <dl className="divide-y divide-border rounded-2xl border bg-card">
            {g.entries.map(({ key, entry }) => (
              <div key={key} id={key} className="scroll-mt-24 p-4 target:bg-primary/5">
                <dt className="font-semibold">{entry.title}</dt>
                <dd className="mt-1 space-y-1.5 text-sm text-muted-foreground">
                  <p>{entry.short}</p>
                  {entry.long && <p>{entry.long}</p>}
                  {entry.do && (
                    <p className="text-foreground">
                      <span className="font-semibold">What you can do: </span>
                      {entry.do}
                    </p>
                  )}
                  {entry.see && (
                    <p>
                      <a href={seeHref(entry.see, repo)} target="_blank" rel="noopener noreferrer" className="break-all underline decoration-dotted underline-offset-2">
                        The spec: {entry.see}
                      </a>
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
