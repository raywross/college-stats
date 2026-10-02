"use client";

import { useEffect, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, Map as MapIcon, ScatterChart, Search, Table2, X } from "lucide-react";
import { SIZE_BUCKETS } from "@/lib/metrics";
import { INDICATORS, INDICATOR_KEYS, isDirection } from "@/lib/indicators";
import { GENDER_BALANCE } from "@/lib/student-body";
import { HOUSING_FILTERS } from "@/lib/housing";
import { FACTOR_FILTERS } from "@/lib/factors";
import { DESIGNATION_LABELS, RESEARCH_LABELS, SETTING_GROUPS, isDesignation, isResearchTier, isSettingGroup } from "@/lib/campus-profile";
import { DIVISION_LABELS, ROTC_LABELS, isDivisionFilter, isRotcBranch } from "@/lib/campus-services";
import { conferenceName } from "@/lib/conferences";
import { typeLabel } from "@/lib/format";
import { useExploreParams } from "./useExploreParams";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- */

export function ExploreSearchInput({ className }: { className?: string }) {
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
    <label
      className={cn(
        "flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border bg-card px-4 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/15",
        className
      )}
    >
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
  { value: "avg_cost_change", label: "Cost change, 10 yrs (biggest drop)", dir: "asc" },
  { value: "admit_rate_change", label: "Admit rate change, 10 yrs (most selective)", dir: "asc" },
  { value: "size_change", label: "Size change, 10 yrs (fastest growth)", dir: "desc" },
  { value: "apps_change", label: "Applications change, 10 yrs (fastest growth)", dir: "desc" },
  { value: "diversity_change", label: "Diversity change, 10 yrs (most diversified)", dir: "desc" },
  { value: "men_share", label: "Share of men (most)", dir: "desc" },
  { value: "part_time", label: "Part-time share (lowest)", dir: "asc" },
  { value: "men_share_change", label: "Men's share change, 10 yrs (biggest drop)", dir: "asc" },
  { value: "admit_gap", label: "Admit rate gap (men higher first)", dir: "desc" },
  { value: "loan_rate", label: "Share who borrow (fewest)", dir: "asc" },
  { value: "student_faculty", label: "Students per faculty (fewest)", dir: "asc" },
  { value: "out_of_state", label: "First-years from other states (most)", dir: "desc" },
  { value: "loan_rate_change", label: "Borrowing change, 10 yrs (biggest drop)", dir: "asc" },
] as const;

export function SortControl() {
  const { searchParams, update } = useExploreParams();
  const sortBy = searchParams.get("sortBy") ?? "applicants";
  const sortDir = searchParams.get("sortDir") ?? (sortBy === "applicants" ? "desc" : "asc");

  return (
    <div className="flex h-10 min-w-0 items-center rounded-full border bg-card pr-1 pl-3.5">
      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="hidden sm:inline">Sort</span>
        <select
          aria-label="Sort by"
          value={sortBy}
          onChange={(e) => {
            const opt = SORTS.find((s) => s.value === e.target.value)!;
            update({ sortBy: opt.value === "applicants" ? null : opt.value, sortDir: opt.dir === "desc" && opt.value !== "applicants" ? "desc" : null });
          }}
          className="w-full min-w-0 cursor-pointer truncate bg-transparent py-1 pr-1 text-sm font-semibold text-foreground outline-none sm:w-auto"
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
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-muted"
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
  { value: "map", label: "Map", icon: MapIcon },
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

  for (const b of getList("balance"))
    chips.push({ key: `b-${b}`, label: GENDER_BALANCE.find((g) => g.key === b)?.label ?? b, onRemove: () => toggleInList("balance", b) });
  if (searchParams.get("fullTime") === "1") chips.push({ key: "fullTime", label: "Mostly full-time", onRemove: () => update({ fullTime: null }) });
  if (searchParams.get("fewLoans") === "1") chips.push({ key: "fewLoans", label: "Few students borrow", onRemove: () => update({ fewLoans: null }) });
  if (searchParams.get("national") === "1") chips.push({ key: "national", label: "Draws nationally", onRemove: () => update({ national: null }) });
  for (const f of [...FACTOR_FILTERS, ...HOUSING_FILTERS]) if (searchParams.get(f.param) === "1") chips.push({ key: f.param, label: f.label, onRemove: () => update({ [f.param]: null }) });

  for (const g of getList("setting").filter(isSettingGroup))
    chips.push({ key: `set-${g}`, label: SETTING_GROUPS.find((x) => x.key === g)!.label, onRemove: () => toggleInList("setting", g) });
  for (const r of getList("research").filter(isResearchTier))
    chips.push({ key: `rs-${r}`, label: RESEARCH_LABELS[r], onRemove: () => toggleInList("research", r) });
  for (const d of getList("designation").filter(isDesignation))
    chips.push({ key: `des-${d}`, label: DESIGNATION_LABELS[d], onRemove: () => toggleInList("designation", d) });

  for (const d of getList("division").filter(isDivisionFilter))
    chips.push({ key: `div-${d}`, label: DIVISION_LABELS[d], onRemove: () => toggleInList("division", d) });
  const conf = Number(searchParams.get("conference"));
  if (searchParams.get("conference") && conferenceName(conf))
    chips.push({ key: "conference", label: conferenceName(conf)!, onRemove: () => update({ conference: null }) });
  if (searchParams.get("football") === "1") chips.push({ key: "football", label: "Has football", onRemove: () => update({ football: null }) });
  for (const b of getList("rotc").filter(isRotcBranch))
    chips.push({ key: `rotc-${b}`, label: `${ROTC_LABELS[b]} ROTC`, onRemove: () => toggleInList("rotc", b) });
  const maxRatio = Number(searchParams.get("maxRatio"));
  if (maxRatio > 0) chips.push({ key: "maxRatio", label: `${maxRatio} or fewer students per faculty`, onRemove: () => update({ maxRatio: null }) });
  if (searchParams.get("ugResearch") === "1") chips.push({ key: "ugResearch", label: "Undergraduate research", onRemove: () => update({ ugResearch: null }) });
  if (searchParams.get("studyAbroad") === "1") chips.push({ key: "studyAbroad", label: "Study abroad", onRemove: () => update({ studyAbroad: null }) });
  if (searchParams.get("opportunity") === "1") chips.push({ key: "opportunity", label: "Opportunity colleges", onRemove: () => update({ opportunity: null }) });

  for (const k of INDICATOR_KEYS) {
    const def = INDICATORS[k];
    for (const d of getList(def.param).filter(isDirection))
      chips.push({
        key: `${def.param}-${d}`,
        // "Cost: Falling", but "More selective" already names the measure.
        label: d !== "steady" && (k === "diversity" || k === "selectivity") ? def.words[d] : `${def.label}: ${def.words[d].toLowerCase()}`,
        onRemove: () => toggleInList(def.param, d),
      });
  }

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
