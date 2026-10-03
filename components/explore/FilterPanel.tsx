"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { HistogramSlider } from "@/components/charts/HistogramSlider";
import { InfoTip } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";
import { DOMAINS, SIZE_BUCKETS } from "@/lib/metrics";
import { DIRECTIONS, INDICATORS, INDICATOR_KEYS, type Direction, type IndicatorKey } from "@/lib/indicators";
import { FULL_TIME_MAX_PART_TIME, GENDER_BALANCE, type GenderBalance } from "@/lib/student-body";
import { FEW_LOANS_MAX } from "@/lib/repayment";
import { HOUSING_FILTERS, type HousingFilterParam } from "@/lib/housing";
import { FACTOR_FILTERS, type FactorFilterParam } from "@/lib/factors";
import { RESIDENCY_FILTERS, type ResidencyFilterParam } from "@/lib/cds/residency-display";
import { DESIGNATION_KEYS, DESIGNATION_LABELS, RESEARCH_TIERS, SETTING_GROUPS } from "@/lib/campus-profile";
import { DIVISION_FILTERS, DIVISION_SHORT, ROTC_BRANCHES, ROTC_LABELS } from "@/lib/campus-services";
import { MAX_RATIO_OPTIONS, MIN_FULL_TIME_FACULTY_OPTIONS } from "@/lib/academics";
import { SMALL_PELL_GAP } from "@/lib/graduation-groups";
import { DRAWS_NATIONALLY } from "@/lib/residence";
import { FIELD_MIN_OPTIONS, MAJOR_FAMILIES, MAJOR_FAMILY_CODES } from "@/lib/majors";
import type { Designation, DivisionFilter, ResearchTier, RotcBranch, SettingGroup } from "@/lib/types";
import { useExploreParams } from "./useExploreParams";
import { cn } from "@/lib/utils";

export interface FilterFacets {
  states: { value: string; count: number }[];
  regions: { value: string; count: number }[];
  types: { value: string; label: string; count: number }[];
  sizes: Record<string, number>;
  arBins: number[];
  satBins: number[];
  costBins: number[];
  satRange: [number, number];
  /** Colleges in each direction of each trend indicator (lib/indicators.ts). */
  trends: Record<IndicatorKey, Record<Direction, number>>;
  /** Colleges in each gender-balance bucket, and mostly full-time colleges (lib/student-body.ts). */
  balance: Record<GenderBalance, number>;
  fullTime: number;
  /** Colleges matching each housing and policy filter (lib/housing.ts). */
  housing: Record<HousingFilterParam, number>;
  /** Colleges matching each admission-factor filter (lib/factors.ts). */
  factors: Record<FactorFilterParam, number>;
  /** Colleges per setting group, research tier, and designation (lib/campus-profile.ts). */
  campus: { setting: Record<SettingGroup, number>; research: Record<ResearchTier, number>; designation: Record<Designation, number>; opportunity: number };
  /** Colleges per division, and with football, each ROTC branch, undergrad research, study abroad (lib/campus-services.ts). */
  services: { division: Record<DivisionFilter, number>; football: number; rotc: Record<RotcBranch, number>; ugResearch: number; studyAbroad: number };
  /** Colleges with at most N students per faculty member, for each option (lib/academics.ts MAX_RATIO_OPTIONS). */
  maxRatio: Record<number, number>;
  medianRatio: number | null;
  /** Colleges with at least this share of full-time faculty, for each option (lib/academics.ts MIN_FULL_TIME_FACULTY_OPTIONS). */
  minFullTimeFaculty: Record<number, number>;
  medianFullTimeFaculty: number | null;
  /** Colleges where few undergrads take federal loans (lib/repayment.ts). */
  fewLoans: number;
  /** Colleges whose Pell graduation gap is under 5 points (lib/graduation-groups.ts). */
  pellGap: number;
  /** Colleges where at least half of first-years come from other states (lib/residence.ts). */
  national: number;
  /** Colleges per bachelor's field at each graduates-a-year threshold (lib/majors.ts fieldFacets). */
  fields: Record<string, number[]>;
  /** Colleges matching each "Where applicants live" chip (lib/cds/residency-display.ts). */
  residency: Record<ResidencyFilterParam, number>;
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
  const minCost = Number(searchParams.get("minCost") ?? 0);
  const maxCost = Number(searchParams.get("maxCost") ?? NP_MAX);
  const activeTypes = getList("types");
  const activeSizes = getList("sizes");
  const activeRegions = getList("regions");
  const activeStates = getList("states");
  const activeBalance = getList("balance");
  const fullTime = searchParams.get("fullTime") === "1";
  const fewLoans = searchParams.get("fewLoans") === "1";
  const pellGap = searchParams.get("pellGap") === "1";
  const national = searchParams.get("national") === "1";
  const field = searchParams.get("field") ?? "";
  const fieldMin = Number(searchParams.get("fieldMin") ?? 1) || 1;
  const fieldOptions = MAJOR_FAMILY_CODES.filter((f) => (facets.fields[f]?.[0] ?? 0) > 0).sort((a, b) => MAJOR_FAMILIES[a].localeCompare(MAJOR_FAMILIES[b]));

  const hasFilters = [
    ...["q", "types", "sizes", "regions", "states", "minAR", "maxAR", "minSAT", "maxSAT", "minCost", "maxCost", "minEnroll", "maxEnroll", "balance", "fullTime", "fewLoans", "liveOn", "noFee", "guarantee", "noLegacy", "noEssay", "gpaRequired", "setting", "research", "designation", "opportunity", "division", "conference", "football", "rotc", "ugResearch", "studyAbroad", "maxRatio", "pellGap", "minFullTimeFaculty", "national", "field", "byRes", "oosEven"],
    ...INDICATOR_KEYS.map((k) => INDICATORS[k].param),
  ].some((k) => searchParams.get(k));

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

      <Section title="Average cost per year" term="average-cost">
        <HistogramSlider
          label="Average cost range"
          bins={facets.costBins}
          min={0}
          max={NP_MAX}
          step={1000}
          value={[minCost, maxCost]}
          format={(v) => (v >= NP_MAX ? "$80K+" : `$${Math.round(v / 1000)}K`)}
          onCommit={([lo, hi]) => update({ minCost: lo > 0 ? String(lo) : null, maxCost: hi < NP_MAX ? String(hi) : null })}
        />
        <p className="text-[11px] text-muted-foreground">Estimated average paid by all first-years, including those without grants. Colleges without enough data are hidden while this is set.</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={fewLoans} onClick={() => update({ fewLoans: fewLoans ? null : "1" })} count={facets.fewLoans}>
            Few students borrow
          </Chip>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {Math.round(FEW_LOANS_MAX * 100)}% or fewer of undergrads take a federal loan.
        </p>
      </Section>

      <Section title="Graduation" term="pell-graduation-gap">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={pellGap} onClick={() => update({ pellGap: pellGap ? null : "1" })} count={facets.pellGap}>
            Pell gap under {Math.round(SMALL_PELL_GAP * 100)} points
          </Chip>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Pell Grant recipients graduate within {Math.round(SMALL_PELL_GAP * 100)} points of students with no need-based federal aid (or more often).
          Colleges with under 30 students in either group are hidden while this is set.
        </p>
      </Section>

      <Section title="10-year direction" term="trend-direction">
        <div className="space-y-3">
          {INDICATOR_KEYS.map((k) => {
            const def = INDICATORS[k];
            const active = getList(def.param);
            return (
              <div key={k} role="group" aria-label={def.question}>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: DOMAINS[def.domain].color }} />
                  {def.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {DIRECTIONS.map((d) => (
                    <Chip key={d} active={active.includes(d)} onClick={() => toggleInList(def.param, d)} count={facets.trends[k][d]}>
                      {def.words[d]}
                    </Chip>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Over each college&apos;s last 10 years of federal data; cost after inflation. Colleges without enough history are hidden while a
          direction is set.
        </p>
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

      <Section title="Student body" term="gender-balance">
        <div role="group" aria-label="Men and women" className="flex flex-wrap gap-1.5">
          {GENDER_BALANCE.map((b) => (
            <Chip key={b.key} active={activeBalance.includes(b.key)} onClick={() => toggleInList("balance", b.key)} count={facets.balance[b.key]}>
              {b.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={fullTime} onClick={() => update({ fullTime: fullTime ? null : "1" })} count={facets.fullTime}>
            Mostly full-time
          </Chip>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Mostly women or men: over 60% one or the other. Mostly full-time: {Math.round(FULL_TIME_MAX_PART_TIME * 100)}% or fewer of undergrads
          study part-time.
        </p>
      </Section>

      <Section title="Where first-years come from" term="in-state-student">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={national} onClick={() => update({ national: national ? null : "1" })} count={facets.national}>
            Draws nationally
          </Chip>
        </div>
        <p className="text-[11px] text-muted-foreground">
          At least {Math.round(DRAWS_NATIONALLY * 100)}% of first-years come from other states. Colleges that don&apos;t report it are hidden while this is set.
        </p>
      </Section>

      <Section title="Majors" term="cip-code">
        <label className="block">
          <span className="sr-only">Field of study</span>
          <select
            value={field}
            onChange={(e) => update({ field: e.target.value || null, fieldMin: null })}
            className="h-9 w-full cursor-pointer rounded-xl border bg-card px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Any field</option>
            {fieldOptions.map((f) => (
              <option key={f} value={f}>
                {MAJOR_FAMILIES[f]} ({facets.fields[f][0]})
              </option>
            ))}
          </select>
        </label>
        {field && facets.fields[field] && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Graduates a year in this field">
            {FIELD_MIN_OPTIONS.map((min, i) => {
              const active = fieldMin === min;
              return (
                <Chip key={min} active={active} onClick={() => update({ fieldMin: min === 1 ? null : String(min) })} count={facets.fields[field][i]}>
                  {min === 1 ? "Any graduates" : `${min}+ a year`}
                </Chip>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Colleges awarding bachelor&apos;s degrees in the field, counting first majors. Colleges that don&apos;t report degrees by field are hidden
          while this is set.
        </p>
      </Section>

      <Section title="Campus" term="locale">
        <div className="space-y-3">
          {(
            [
              { param: "setting", label: "Setting", options: SETTING_GROUPS.map((g) => ({ value: g.key, label: g.label })), counts: facets.campus.setting },
              { param: "research", label: "Research", options: RESEARCH_TIERS.map((r) => ({ value: r, label: r === "RCU" ? "Research college" : r })), counts: facets.campus.research },
              { param: "designation", label: "Designation", options: DESIGNATION_KEYS.map((d) => ({ value: d, label: DESIGNATION_LABELS[d] })), counts: facets.campus.designation },
            ] as const
          ).map((g) => {
            const active = getList(g.param);
            return (
              <div key={g.param} role="group" aria-label={g.label}>
                <p className="mb-1.5 text-xs font-semibold">{g.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.options.map((o) => (
                    <Chip key={o.value} active={active.includes(o.value)} onClick={() => toggleInList(g.param, o.value)} count={(g.counts as Record<string, number>)[o.value]}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </div>
            );
          })}
          <div>
            <Chip
              active={searchParams.get("opportunity") === "1"}
              onClick={() => update({ opportunity: searchParams.get("opportunity") === "1" ? null : "1" })}
              count={facets.campus.opportunity}
            >
              Opportunity colleges
            </Chip>
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              Carnegie&apos;s higher access, higher earnings class. <InfoTip term="student-access-and-earnings" />
            </p>
          </div>
        </div>
      </Section>

      <Section title="Students per faculty" term="student-faculty-ratio">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="At most this many students per faculty member">
          {MAX_RATIO_OPTIONS.map((n) => {
            const active = searchParams.get("maxRatio") === String(n);
            return (
              <Chip key={n} active={active} onClick={() => update({ maxRatio: active ? null : String(n) })} count={facets.maxRatio[n]}>
                {n} or fewer
              </Chip>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">The national median is {facets.medianRatio ?? "–"}. Colleges that don&apos;t report it are hidden while this is set.</p>
      </Section>

      <Section title="Full-time faculty" term="full-time-faculty">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="At least this share of faculty are full-time">
          {MIN_FULL_TIME_FACULTY_OPTIONS.map((n) => {
            const active = searchParams.get("minFullTimeFaculty") === String(Math.round(n * 100));
            return (
              <Chip key={n} active={active} onClick={() => update({ minFullTimeFaculty: active ? null : String(Math.round(n * 100)) })} count={facets.minFullTimeFaculty[n]}>
                {Math.round(n * 100)}% or more
              </Chip>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          The national median is {facets.medianFullTimeFaculty === null ? "–" : `${Math.round(facets.medianFullTimeFaculty * 100)}%`}. Colleges that don&apos;t report it are hidden while this
          is set.
        </p>
      </Section>

      <Section title="Sports & programs" term="ncaa-division">
        <div className="space-y-3">
          <div role="group" aria-label="Athletics">
            <p className="mb-1.5 text-xs font-semibold">Athletics</p>
            <div className="flex flex-wrap gap-1.5">
              {DIVISION_FILTERS.map((d) => (
                <Chip key={d} active={getList("division").includes(d)} onClick={() => toggleInList("division", d)} count={facets.services.division[d]}>
                  {DIVISION_SHORT[d]}
                </Chip>
              ))}
              <Chip active={searchParams.get("football") === "1"} onClick={() => update({ football: searchParams.get("football") === "1" ? null : "1" })} count={facets.services.football}>
                Has football
              </Chip>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">D-I without football is plain D-I. Tap a conference on a profile to see its members.</p>
          </div>
          <div role="group" aria-label="ROTC">
            <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold">
              ROTC <InfoTip term="rotc" />
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ROTC_BRANCHES.map((b) => (
                <Chip key={b} active={getList("rotc").includes(b)} onClick={() => toggleInList("rotc", b)} count={facets.services.rotc[b]}>
                  {ROTC_LABELS[b]}
                </Chip>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Programs">
            <p className="mb-1.5 text-xs font-semibold">Programs</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={searchParams.get("ugResearch") === "1"} onClick={() => update({ ugResearch: searchParams.get("ugResearch") === "1" ? null : "1" })} count={facets.services.ugResearch}>
                Undergraduate research
              </Chip>
              <Chip active={searchParams.get("studyAbroad") === "1"} onClick={() => update({ studyAbroad: searchParams.get("studyAbroad") === "1" ? null : "1" })} count={facets.services.studyAbroad}>
                Study abroad
              </Chip>
            </div>
          </div>
        </div>
      </Section>

      <Section title="What they look at" term="admission-factor">
        <div className="flex flex-wrap gap-1.5">
          {FACTOR_FILTERS.map((f) => {
            const active = searchParams.get(f.param) === "1";
            return (
              <Chip key={f.param} active={active} onClick={() => update({ [f.param]: active ? null : "1" })} count={facets.factors[f.param]}>
                {f.label}
              </Chip>
            );
          })}
        </div>
      </Section>

      <Section title="Where applicants live" term="admit-rate-by-residency">
        <div className="flex flex-wrap gap-1.5">
          {RESIDENCY_FILTERS.map((f) => {
            const active = searchParams.get(f.param) === "1";
            return (
              <Chip key={f.param} active={active} onClick={() => update({ [f.param]: active ? null : "1" })} count={facets.residency[f.param]}>
                {f.label}
              </Chip>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">Only the {facets.residency.byRes} colleges that publish these figures in their Common Data Set can match.</p>
      </Section>

      <Section title="Housing & policies" term="housing-capacity">
        <div className="flex flex-wrap gap-1.5">
          {HOUSING_FILTERS.map((f) => {
            const active = searchParams.get(f.param) === "1";
            return (
              <Chip key={f.param} active={active} onClick={() => update({ [f.param]: active ? null : "1" })} count={facets.housing[f.param]}>
                {f.label}
              </Chip>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          &quot;Live on campus&quot; is the strict rule: every full-time first-year, no exceptions. Many more colleges expect it with
          exceptions.
        </p>
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
