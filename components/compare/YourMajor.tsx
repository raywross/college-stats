"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { FieldStat } from "@/lib/field-compare";
import { SLOT_COLORS } from "@/lib/brand";
import { money, num, pct } from "@/lib/format";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";
import posthog from "posthog-js";

/**
 * Compare "Your major" (specs/data-expansion/majors.md, field-of-study.md): pick a broad field (2-digit CIP family)
 * and compare it across the colleges. Only fields at least one compared college awards bachelor's in are offered.
 * The server precomputes every offered field (lib/field-compare.ts), so picking one swaps this section in place, with
 * no navigation or scroll jump; the choice still goes in the URL (`?major=11`) for reloads and sharing, and the form
 * still works as a plain GET without JavaScript.
 */
export interface YourMajorProps {
  ids: string;
  schools: { id: string; name: string; slot: number }[];
  options: { family: string; title: string }[];
  /** Per field, one FieldStat per school in `schools` order. */
  stats: Record<string, FieldStat[]>;
  initial: string | null;
}

export function YourMajor({ ids, schools, options, stats, initial }: YourMajorProps) {
  const [selected, setSelected] = useState<string | null>(initial);
  const [draft, setDraft] = useState<string>(initial ?? "");
  if (!options.length) return null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft || !stats[draft]) return;
    setSelected(draft);
    posthog.capture("major_comparison_selected", {
      compared_school_count: schools.length,
      field_family: draft,
    });
    const url = new URL(window.location.href);
    url.searchParams.set("major", draft);
    window.history.replaceState(null, "", url);
  }

  const title = selected ? options.find((o) => o.family === selected)?.title ?? selected : null;
  const rows = selected ? stats[selected] : null;

  return (
    <div className="space-y-4">
      <form method="GET" onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="ids" value={ids} />
        {/* w-full/min-w-0: a long field name would otherwise size the select past a phone's width. */}
        <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:w-auto">
          <span className="font-medium">Your major</span>
          <select
            name="major"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-w-0 rounded-xl border bg-card px-3 py-2 text-sm sm:w-[24rem] sm:max-w-full"
          >
            <option value="" disabled>
              Choose a field of study…
            </option>
            {options.map((o) => (
              <option key={o.family} value={o.family}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Compare
        </button>
      </form>
      {title && rows && <FieldComparison key={selected} title={title} schools={schools} rows={rows} />}
    </div>
  );
}

function FieldComparison({ title, schools, rows }: { title: string; schools: YourMajorProps["schools"]; rows: FieldStat[] }) {
  const none = (r: FieldStat) => r.graduates === 0;
  const noneNote = (r: FieldStat) => (r.graduates === null ? "Not reported" : none(r) ? "Doesn't offer this field" : null);
  const earnNote = (r: FieldStat) =>
    noneNote(r) ?? (r.earnings.programsReported === 0 ? "No earnings reported" : r.earnings.programsWithData === 0 ? "Too few graduates to report" : "Not reported");

  return (
    <div className="space-y-4" aria-live="polite">
      <h3 className="font-display text-lg font-bold">{title}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Bars
          label="Bachelor's degrees in this field"
          term="first-major"
          sub="First majors, newest year"
          schools={schools}
          values={rows.map((r) => r.graduates || null)}
          notes={rows.map((r) => noneNote(r) ?? "Not reported")}
          format={num}
          flag="Most"
          extra={rows.map((r) => (r.secondMajors ? `+${num(r.secondMajors)} as a second major` : null))}
        />
        <Bars
          label="Share of the college's graduates"
          term="first-major"
          sub="Share of first-major bachelor's"
          schools={schools}
          values={rows.map((r) => (r.graduates ? r.share : null))}
          notes={rows.map((r) => noneNote(r) ?? "Not reported")}
          format={(v) => pct(v)}
          flag="Largest"
          extra={rows.map((r) =>
            r.shareChange && r.graduates ? `${pct(r.shareChange.from.share)} in ${r.shareChange.from.label} → ${pct(r.shareChange.to.share)} in ${r.shareChange.to.label}` : null,
          )}
        />
        <Bars
          label="Earnings 4 years after completion"
          term="earnings-after-completion"
          sub="Typical across the field's programs"
          schools={schools}
          values={rows.map((r) => r.earnings.y4)}
          notes={rows.map(earnNote)}
          format={money}
          flag="Highest"
          ticks={rows.map((r) => r.earnings.y4National)}
          extra={rows.map((r) => (r.earnings.y1 !== null ? `${money(r.earnings.y1)} after 1 year` : null))}
        />
        <Bars
          label="Median federal debt"
          term="median-debt"
          sub="Graduates who borrowed, typical across programs"
          schools={schools}
          values={rows.map((r) => r.earnings.debt)}
          notes={rows.map(earnNote)}
          format={money}
          flag="Lowest"
          flagMin
        />
      </div>
      <div className="rounded-3xl border bg-card p-4 sm:p-6">
        <MetricLabel term="cip-code" className="mb-3 font-display text-base font-bold">
          Programs in this field
        </MetricLabel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {schools.map((s, i) => {
            const r = rows[i];
            return (
              <div key={s.id} className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[s.slot] }} />
                  <span className="truncate">{s.name}</span>
                </div>
                {r.programCount ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {r.programCount} {r.programCount === 1 ? "program" : "programs"} awarding bachelor&apos;s
                    </p>
                    <ul className="space-y-0.5 text-sm">
                      {r.topPrograms.map((p) => (
                        <li key={p.title} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate">{p.title}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{num(p.graduates)}</span>
                        </li>
                      ))}
                    </ul>
                    {r.topEarner && (
                      <p className="pt-1 text-xs text-muted-foreground">
                        Top earner: <span className="font-medium text-foreground">{r.topEarner.title}</span>, {money(r.topEarner.value)} after {r.topEarner.years}{" "}
                        {r.topEarner.years === 1 ? "year" : "years"}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{noneNote(r) ?? "Not reported"}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="max-w-3xl text-xs text-muted-foreground">
        Broad fields group related programs, since colleges name and split programs differently. Earnings and debt are each program&apos;s median, weighted by
        its graduates, so they&apos;re a typical figure for the field rather than a true median; the tick marks the national figure for the same programs.
        Earnings are measured from <Term term="earnings-after-completion">completion</Term>, not entry.
      </p>
    </div>
  );
}

function Bars({
  label,
  term,
  sub,
  schools,
  values,
  notes,
  format,
  flag,
  flagMin,
  ticks,
  extra,
}: {
  label: string;
  term: TermKey;
  sub: string;
  schools: YourMajorProps["schools"];
  values: (number | null)[];
  notes: string[];
  format: (v: number) => string;
  flag?: string;
  flagMin?: boolean;
  ticks?: (number | null)[];
  extra?: (ReactNode | null)[];
}) {
  const present = values.filter((v): v is number => v !== null);
  const top = Math.max(1e-9, ...present, ...(ticks ?? []).filter((v): v is number => v !== null));
  const target = flag && new Set(present).size > 1 ? (flagMin ? Math.min(...present) : Math.max(...present)) : null;
  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-5">
      <MetricLabel term={term} className="font-display text-base font-bold">
        {label}
      </MetricLabel>
      <p className="mb-4 text-xs text-muted-foreground">{sub}</p>
      <div className="space-y-3">
        {schools.map((s, i) => {
          const v = values[i];
          const tick = ticks?.[i] ?? null;
          return (
            <div key={s.id}>
              <div className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-3 sm:grid-cols-[6rem_1fr_9.5rem]">
                <span className="truncate text-xs font-semibold">{s.name}</span>
                <span className="relative h-3 rounded-full bg-muted">
                  {v !== null && (
                    <span
                      className="block h-full origin-left animate-grow-x rounded-full"
                      style={{ width: `${Math.max(2, Math.min(100, (v / top) * 100))}%`, backgroundColor: SLOT_COLORS[s.slot], animationDelay: `${i * 80}ms` }}
                    />
                  )}
                  {v !== null && tick !== null && (
                    <span
                      className="absolute -top-0.5 h-4 w-0.5 rounded-full bg-foreground/70"
                      style={{ left: `${Math.min(100, (tick / top) * 100)}%` }}
                      title={`National: ${format(tick)}`}
                    />
                  )}
                </span>
                <span className="flex items-center justify-end gap-1.5 text-right text-sm font-bold tabular-nums">
                  {v === null ? <span className="text-xs font-normal text-muted-foreground">{notes[i]}</span> : format(v)}
                  {v !== null && v === target && (
                    <span className="hidden rounded-full bg-pop px-1.5 py-0.5 text-[10px] font-bold text-pop-foreground sm:inline">{flag}</span>
                  )}
                </span>
              </div>
              {v !== null && (extra?.[i] || tick !== null) && (
                <p className="mt-0.5 pl-[5.25rem] text-[11px] text-muted-foreground tabular-nums sm:pl-[6.75rem]">
                  {extra?.[i]}
                  {extra?.[i] && tick !== null ? " · " : ""}
                  {tick !== null ? `national ${format(tick)}` : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
