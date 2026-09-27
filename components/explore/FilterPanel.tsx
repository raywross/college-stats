"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { HistogramSlider } from "@/components/charts/HistogramSlider";
import { InfoTip } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";
import { SIZE_BUCKETS } from "@/lib/metrics";
import { useExploreParams } from "./useExploreParams";
import { cn } from "@/lib/utils";

export interface FilterFacets {
  states: { value: string; count: number }[];
  regions: { value: string; count: number }[];
  types: { value: string; label: string; count: number }[];
  sizes: Record<string, number>;
  arBins: number[];
  satBins: number[];
  npBins: number[];
  satRange: [number, number];
}

function Section({ title, term, children }: { title: string; term?: TermKey; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b pb-5 last:border-0">
      <h3 className="flex items-center gap-1 text-sm font-bold">
        {title}
        {term && <InfoTip term={term} />}
      </h3>
      {children}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={!active && count === 0}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-35",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground hover:border-foreground/40"
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn("tabular-nums", active ? "text-background/70" : "text-muted-foreground")}>{count}</span>
      )}
    </button>
  );
}

export function FilterPanel({ facets, onDone }: { facets: FilterFacets; onDone?: () => void }) {
  const router = useRouter();
  const { searchParams, update, getList, toggleInList } = useExploreParams();

  const minAR = Number(searchParams.get("minAR") ?? 0);
  const maxAR = Number(searchParams.get("maxAR") ?? 100);
  const [satLo, satHi] = facets.satRange;
  const minSAT = Number(searchParams.get("minSAT") ?? satLo);
  const maxSAT = Number(searchParams.get("maxSAT") ?? satHi);

  const NP_MAX = 80000;
  const minNP = Number(searchParams.get("minNP") ?? 0);
  const maxNP = Number(searchParams.get("maxNP") ?? NP_MAX);
  const activeTypes = getList("types");
  const activeSizes = getList("sizes");
  const activeRegions = getList("regions");
  const activeStates = getList("states");

  const hasFilters = ["q", "types", "sizes", "regions", "states", "minAR", "maxAR", "minSAT", "maxSAT", "minNP", "maxNP", "minEnroll", "maxEnroll"].some((k) =>
    searchParams.get(k)
  );

  const clearAll = () => {
    const keep = new URLSearchParams();
    for (const k of ["sortBy", "sortDir", "view"]) {
      const v = searchParams.get(k);
      if (v) keep.set(k, v);
    }
    router.push(`/explore${keep.size ? `?${keep}` : ""}`, { scroll: false });
    onDone?.();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Filters</h2>
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" /> Reset
          </button>
        )}
      </div>

      <Section title="Acceptance rate" term="acceptance-rate">
        <HistogramSlider
          label="Acceptance rate range"
          bins={facets.arBins}
          min={0}
          max={100}
          value={[minAR, maxAR]}
          format={(v) => `${v}%`}
          onCommit={([lo, hi]) =>
            update({ minAR: lo > 0 ? String(lo) : null, maxAR: hi < 100 ? String(hi) : null })
          }
        />
      </Section>

      <Section title="SAT middle 50%" term="middle-50">
        <HistogramSlider
          label="SAT range"
          bins={facets.satBins}
          min={satLo}
          max={satHi}
          step={10}
          value={[minSAT, maxSAT]}
          format={(v) => String(v)}
          onCommit={([lo, hi]) =>
            update({ minSAT: lo > satLo ? String(lo) : null, maxSAT: hi < satHi ? String(hi) : null })
          }
        />
        <p className="text-[11px] text-muted-foreground">Shows schools whose middle-50% range overlaps yours.</p>
      </Section>

      <Section title="Net price per year" term="net-price">
        <HistogramSlider
          label="Net price range"
          bins={facets.npBins}
          min={0}
          max={NP_MAX}
          step={1000}
          value={[minNP, maxNP]}
          format={(v) => (v >= NP_MAX ? "$80K+" : `$${Math.round(v / 1000)}K`)}
          onCommit={([lo, hi]) => update({ minNP: lo > 0 ? String(lo) : null, maxNP: hi < NP_MAX ? String(hi) : null })}
        />
        <p className="text-[11px] text-muted-foreground">Average for students receiving grants. Colleges that don&apos;t report it are hidden while this is set.</p>
      </Section>

      <Section title="Type" term="private-nonprofit">
        <div className="flex flex-wrap gap-1.5">
          {facets.types.map((t) => (
            <Chip key={t.value} active={activeTypes.includes(t.value)} onClick={() => toggleInList("types", t.value)} count={t.count}>
              {t.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Size" term="size-tier">
        <div className="grid grid-cols-2 gap-1.5">
          {SIZE_BUCKETS.map((b) => {
            const active = activeSizes.includes(b.key);
            const count = facets.sizes[b.key] ?? 0;
            return (
              <button
                key={b.key}
                type="button"
                aria-pressed={active}
                disabled={!active && count === 0}
                onClick={() => toggleInList("sizes", b.key)}
                className={cn(
                  "flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-all active:scale-95 disabled:opacity-35",
                  active ? "border-foreground bg-foreground text-background" : "bg-card hover:border-foreground/40"
                )}
              >
                <span className="text-xs font-bold">{b.label}</span>
                <span className={cn("text-[11px]", active ? "text-background/70" : "text-muted-foreground")}>
                  {b.hint} · {count}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Region" term="region">
        <div className="flex flex-wrap gap-1.5">
          {facets.regions.map((r) => (
            <Chip key={r.value} active={activeRegions.includes(r.value)} onClick={() => toggleInList("regions", r.value)} count={r.count}>
              {r.value}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="State">
        <div className="-mr-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto pr-2">
          {facets.states.map((s) => (
            <Chip key={s.value} active={activeStates.includes(s.value)} onClick={() => toggleInList("states", s.value)} count={s.count}>
              {s.value}
            </Chip>
          ))}
        </div>
      </Section>
    </div>
  );
}
