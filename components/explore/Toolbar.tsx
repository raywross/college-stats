"use client";

import { useEffect, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, ScatterChart, Search, Table2, X } from "lucide-react";
import { SIZE_BUCKETS } from "@/lib/metrics";
import { typeLabel } from "@/lib/format";
import { useExploreParams } from "./useExploreParams";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- */

export function ExploreSearchInput() {
  const { searchParams, update } = useExploreParams();
  const urlQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  const [pushed, setPushed] = useState(urlQ);

  // Adopt external changes (e.g. Reset) but not echoes of our own pushes.
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);
    if (urlQ !== pushed) {
      setQ(urlQ);
      setPushed(urlQ);
    }
  }

  useEffect(() => {
    if (q === pushed) return;
    const t = setTimeout(() => {
      setPushed(q);
      update({ q: q.trim() || null });
    }, 250);
    return () => clearTimeout(t);
  }, [q, pushed, update]);

  return (
    <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border bg-card px-4 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/15">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">Search schools</span>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by name, city, or state"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
    </label>
  );
}

/* ---------------------------------------------------------------- */

const SORTS = [
  { value: "applicants", label: "Most applied-to", dir: "desc" },
  { value: "name", label: "Name", dir: "asc" },
  { value: "acceptance_rate", label: "Acceptance rate", dir: "asc" },
  { value: "sat", label: "SAT midpoint", dir: "desc" },
  { value: "enrollment", label: "Size", dir: "desc" },
  { value: "pell", label: "Pell share", dir: "desc" },
  { value: "first_gen", label: "First-gen share", dir: "desc" },
  { value: "diversity", label: "Diversity index", dir: "desc" },
  { value: "avg_cost", label: "Average cost (lowest)", dir: "asc" },
  { value: "aid_generosity", label: "Aid generosity (most)", dir: "desc" },
  { value: "net_price", label: "Net price with grants (lowest)", dir: "asc" },
  { value: "earnings", label: "Earnings (highest)", dir: "desc" },
  { value: "grad_rate", label: "Graduation rate", dir: "desc" },
] as const;

export function SortControl() {
  const { searchParams, update } = useExploreParams();
  const sortBy = searchParams.get("sortBy") ?? "applicants";
  const sortDir = searchParams.get("sortDir") ?? (sortBy === "applicants" ? "desc" : "asc");

  return (
    <div className="flex h-10 items-center rounded-full border bg-card pr-1 pl-3.5">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Sort
        <select
          value={sortBy}
          onChange={(e) => {
            const opt = SORTS.find((s) => s.value === e.target.value)!;
            update({ sortBy: opt.value === "applicants" ? null : opt.value, sortDir: opt.dir === "desc" && opt.value !== "applicants" ? "desc" : null });
          }}
          className="cursor-pointer bg-transparent py-1 pr-1 text-sm font-semibold text-foreground outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => update({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
        aria-label={sortDir === "asc" ? "Sorted ascending; switch to descending" : "Sorted descending; switch to ascending"}
        className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted"
      >
        {sortDir === "asc" ? <ArrowUpNarrowWide className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- */

const VIEWS = [
  { value: "grid", label: "Cards", icon: LayoutGrid },
  { value: "table", label: "Table", icon: Table2 },
  { value: "chart", label: "Chart", icon: ScatterChart },
] as const;

export function ViewToggle() {
  const { searchParams, update } = useExploreParams();
  const view = searchParams.get("view") ?? "grid";
  return (
    <div role="radiogroup" aria-label="View" className="inline-flex h-10 items-center rounded-full border bg-card p-1">
      {VIEWS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          onClick={() => update({ view: value === "grid" ? null : value })}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-all",
            view === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="size-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */

export function ActiveFilters() {
  const { searchParams, update, getList, toggleInList } = useExploreParams();
  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  const q = searchParams.get("q");
  if (q) chips.push({ key: "q", label: `“${q}”`, onRemove: () => update({ q: null }) });

  const minAR = searchParams.get("minAR");
  const maxAR = searchParams.get("maxAR");
  if (minAR || maxAR)
    chips.push({
      key: "ar",
      label: `Admit ${minAR ?? 0}–${maxAR ?? 100}%`,
      onRemove: () => update({ minAR: null, maxAR: null }),
    });

  const minSAT = searchParams.get("minSAT");
  const maxSAT = searchParams.get("maxSAT");
  if (minSAT || maxSAT)
    chips.push({
      key: "sat",
      label: `SAT ${minSAT ?? "…"}–${maxSAT ?? "1600"}`,
      onRemove: () => update({ minSAT: null, maxSAT: null }),
    });

  const minCost = searchParams.get("minCost");
  const maxCost = searchParams.get("maxCost");
  if (minCost || maxCost)
    chips.push({
      key: "cost",
      label: `Avg cost $${Math.round(Number(minCost ?? 0) / 1000)}K–$${maxCost ? Math.round(Number(maxCost) / 1000) + "K" : "80K+"}`,
      onRemove: () => update({ minCost: null, maxCost: null }),
    });

  const minEnroll = searchParams.get("minEnroll");
  const maxEnroll = searchParams.get("maxEnroll");
  if (minEnroll || maxEnroll)
    chips.push({
      key: "enroll",
      label: minEnroll && maxEnroll ? `${minEnroll}–${maxEnroll} undergrads` : minEnroll ? `${Number(minEnroll).toLocaleString()}+ undergrads` : `Up to ${Number(maxEnroll).toLocaleString()} undergrads`,
      onRemove: () => update({ minEnroll: null, maxEnroll: null }),
    });

  for (const t of getList("types")) chips.push({ key: `t-${t}`, label: typeLabel(t), onRemove: () => toggleInList("types", t) });
  for (const s of getList("sizes"))
    chips.push({
      key: `s-${s}`,
      label: SIZE_BUCKETS.find((b) => b.key === s)?.label ?? s,
      onRemove: () => toggleInList("sizes", s),
    });
  for (const r of getList("regions")) chips.push({ key: `r-${r}`, label: r, onRemove: () => toggleInList("regions", r) });
  for (const s of getList("states")) chips.push({ key: `st-${s}`, label: s, onRemove: () => toggleInList("states", s) });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.onRemove}
          className="group inline-flex animate-pop-in items-center gap-1 rounded-full bg-pop py-1 pr-1.5 pl-3 text-xs font-bold text-pop-foreground"
          aria-label={`Remove filter ${c.label}`}
        >
          {c.label}
          <span className="inline-flex size-4 items-center justify-center rounded-full bg-pop-foreground/10 group-hover:bg-pop-foreground/20">
            <X className="size-3" />
          </span>
        </button>
      ))}
    </div>
  );
}
