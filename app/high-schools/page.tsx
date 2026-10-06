import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { STATES } from "@/lib/states";
import { searchHighSchools } from "@/lib/high-schools";

export const metadata: Metadata = { title: "High schools" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Name/state search over high schools (specs/product/high-school-data.md "Search"). A plain GET form, server
 * rendered: works without client JS, and re-searching is just a page load with new query params. The `/me` picker
 * (components/high-schools/HighSchoolPicker.tsx) covers the typeahead case instead.
 */
export default async function HighSchoolsPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = one(params.q).trim();
  const state = one(params.state).trim().toUpperCase();
  const kindParam = one(params.kind);
  const kind = kindParam === "public" || kindParam === "private" ? kindParam : undefined;
  const searched = q.length > 0 || state.length > 0;
  const hits = searched ? await searchHighSchools({ q, state: state || undefined, kind, limit: 30 }) : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">High schools</h1>
        <p className="mt-1 text-muted-foreground">
          How rigorous a school is, how its graduates do, and where they go to college — described, never graded, and always against its own state.
        </p>
      </header>

      <form method="GET" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input type="search" name="q" defaultValue={q} placeholder="Search by school name or city…" className={`${inputCls} pl-10`} />
        </div>
        <select name="state" defaultValue={state} className={`${inputCls} sm:w-48`} aria-label="State">
          <option value="">Any state</option>
          {[...STATES.values()].filter((s) => s.state).map((s) => (
            <option key={s.postal} value={s.postal}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="submit" className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground">
          Search
        </button>
      </form>

      <div className="mt-8">
        {!searched ? (
          <p className="text-sm text-muted-foreground">Search by name, city, or pick a state to browse its public and private high schools.</p>
        ) : hits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No high schools matched. Try a different name or state.</p>
        ) : (
          <ul className="space-y-2">
            {hits.map((h) => (
              <li key={h.id}>
                <Link href={`/high-schools/${h.id}`} className="group flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="truncate font-display font-bold group-hover:text-primary">{h.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {h.district ? `${h.district} · ` : ""}
                      {h.city ? `${h.city}, ${h.state}` : h.state} · {h.kind === "private" ? "Private" : "Public"} · Grades {h.grades}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
