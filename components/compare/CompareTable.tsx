import { ExternalLink } from "lucide-react";
import type { Dataset } from "@/lib/data";
import type { School } from "@/lib/types";
import { DOMAINS } from "@/lib/metrics";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { linkHost } from "@/lib/links";
import { LOGISTICS_ROW_LABELS, compareTopicOf, type CompareTableGroup } from "@/lib/compare-topics";
import { admissionProfileCellField } from "@/lib/cds/compare-rows";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { COMPARE_BAND, COMPARE_BLOCK_SCROLL } from "./CompareTopicPage";

/** Fewer than two colleges have a value, or every value shown is the same: "Differences only" hides the row. */
function allSame(values: (string | null)[]): boolean {
  const present = values.filter((v) => v !== null);
  return present.length < 2 || new Set(present).size === 1;
}

const LABEL_CELL = "sticky left-0 z-10 max-w-36 bg-card px-3 py-2.5 text-muted-foreground shadow-[1px_0_0_var(--border)] sm:max-w-none sm:px-4 sm:shadow-none";

/**
 * "All the numbers" (specs/compare-redesign.md#topic-pages): every row in one table, a heading row per topic group
 * (each an anchor, `#cost`), a cited (i) on every row, and a cell's own year after its value when it differs from the
 * row's. Rows marked `data-same` hide under the "Differences only" switch (DifferencesOnly). The first column sticks on
 * phones, where the box scrolls sideways; from `lg` the box doesn't scroll, so the header row sticks under the compare band.
 */
export function CompareTable({ schools, citeField, groups }: { schools: School[]; citeField: Dataset["citeField"]; groups: readonly CompareTableGroup[] }) {
  const websites = schools.map((s) => s.links?.website ?? null);
  return (
    // `overflow-clip` from lg clips to the rounded corners without making a scroll box, so the header row can stick.
    <div className="overflow-x-auto rounded-3xl border bg-card lg:overflow-clip">
      <table className="w-full min-w-[480px] text-sm sm:min-w-[560px]">
        <thead className="border-b bg-surface-2 lg:sticky lg:z-20" style={{ top: `calc(env(safe-area-inset-top, 0px) + var(--header-h) + ${COMPARE_BAND})` }}>
          <tr>
            {/* lg: a wider label column, so labels stay on one line beside the "On this page" column. */}
            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-3 text-left text-xs font-semibold text-muted-foreground sm:px-4 lg:w-64 lg:shadow-[0_1px_0_var(--border)]">Metric</th>
            {schools.map((s, i) => (
              <th key={s.unit_id} className="bg-surface-2 px-4 py-3 text-left text-xs font-bold lg:shadow-[0_1px_0_var(--border)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                  {shortName(s)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => {
          const domain = compareTopicOf(group.topic).domain;
          const color = domain ? DOMAINS[domain].color : "var(--primary)";
          const rows = group.rows
            .map(([label, term, field, fmt]) => ({ label, term, field, values: schools.map((s) => fmt(s)) }))
            .filter((r) => !LOGISTICS_ROW_LABELS.has(r.label) || r.values.some((v) => v !== null));
          const same = rows.map((r) => allSame(r.values));
          return (
            <tbody key={group.topic} className="divide-y border-t tabular-nums">
              <tr data-group={group.topic} data-same={same.every(Boolean) ? "" : undefined} className="bg-muted/40">
                <th colSpan={schools.length + 1} scope="rowgroup" className="relative px-3 py-2.5 text-left sm:px-4">
                  {/* The group's anchor: from lg it sits one header row above, so a jump lands below the sticky header row. */}
                  <span id={group.topic} className={cn("absolute top-0 lg:-top-10", COMPARE_BLOCK_SCROLL)} />
                  <span className="sticky left-3 inline-flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase sm:left-4">
                    <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-foreground/80">{group.title}</span>
                  </span>
                </th>
              </tr>
              {rows.map(({ label, term, field, values }, r) => {
                const rowYear = citeField(field).year;
                return (
                  <tr key={label} data-same={same[r] ? "" : undefined}>
                    <td className={LABEL_CELL}>
                      <span className="inline-flex items-center gap-1">
                        {label} <InfoTip term={term} cited={citeField(field)} />
                      </span>
                    </td>
                    {schools.map((s, i) => {
                      const value = values[i];
                      const cellYear = citeField(admissionProfileCellField(label, s) ?? field, s).year;
                      return (
                        <td key={s.unit_id} className="px-4 py-2.5 font-semibold">
                          {value ?? <span className="font-normal text-muted-foreground">–</span>}
                          {value !== null && cellYear !== rowYear && <span className="ml-1.5 align-middle text-[11px] font-normal text-muted-foreground">{cellYear}</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          );
        })}
        {/* An actual link per college, not text, so it isn't one of the generic string rows above (links.md). */}
        <tbody className="border-t">
          <tr data-same={allSame(websites) ? "" : undefined}>
            <td className={LABEL_CELL}>
              <span className="inline-flex items-center gap-1">
                Website <SourceTip cited={citeField("links.website")} />
              </span>
            </td>
            {schools.map((s) => (
              <td key={s.unit_id} className="px-4 py-2.5 font-semibold">
                {s.links?.website ? (
                  <a href={s.links.website} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                    {linkHost(s.links.website)} <ExternalLink className="size-3 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span className="font-normal text-muted-foreground">–</span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
