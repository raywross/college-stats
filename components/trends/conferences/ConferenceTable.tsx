"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { formatBy } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ConferenceTableRow {
  code: number;
  slug: string;
  name: string;
  members: number;
  /** Football-only league: its football members (no medians). */
  footballOnly?: number;
  tooFew?: boolean;
  acceptance: number | null;
  cost: number | null;
  appsChange: number | null;
}

export interface ConferenceTableGroup {
  level: string;
  label: string;
  rows: ConferenceTableRow[];
}

type SortKey = "name" | "members" | "acceptance" | "cost" | "appsChange";

const columns = (appsLabel: string): { key: SortKey; label: string; numeric: boolean }[] => [
  { key: "name", label: "Conference", numeric: false },
  { key: "members", label: "Members", numeric: true },
  { key: "acceptance", label: "Acceptance rate", numeric: true },
  { key: "cost", label: "Average cost", numeric: true },
  { key: "appsChange", label: appsLabel, numeric: true },
];

function compare(a: ConferenceTableRow, b: ConferenceTableRow, key: SortKey, dir: 1 | -1): number {
  if (key === "name") return dir * a.name.localeCompare(b.name);
  const [x, y] = [a[key], b[key]];
  // Rows without a value sort last in either direction.
  if (x === null && y === null) return a.name.localeCompare(b.name);
  if (x === null) return 1;
  if (y === null) return -1;
  return dir * (x - y) || a.name.localeCompare(b.name);
}

/**
 * The conferences index's table (specs/trends/conferences.md): grouped by level, sorted by name by default (rule 7:
 * no ranking by prestige); any column header re-sorts within each level. Under the floor: count only.
 */
export function ConferenceTable({ groups, floor, caption, appsLabel }: { groups: ConferenceTableGroup[]; floor: number; caption: string; appsLabel: string }) {
  const COLUMNS = columns(appsLabel);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const click = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));

  return (
    <div className="relative overflow-x-auto rounded-3xl border bg-card max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {COLUMNS.map((c, i) => {
              const active = sort.key === c.key;
              const Icon = active ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                  className={cn("px-3 py-2.5 font-semibold", c.numeric && "text-right", i === 0 && "sticky left-0 z-10 bg-card pl-4")}
                >
                  <button type="button" onClick={() => click(c.key)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
                    {c.label}
                    <Icon className="size-3" aria-hidden />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.level}>
            <tr className="bg-surface-2">
              <th colSpan={COLUMNS.length} scope="colgroup" className="sticky left-0 px-4 py-1.5 text-left text-xs font-bold tracking-wide text-muted-foreground uppercase">
                {g.label}
              </th>
            </tr>
            {[...g.rows]
              .sort((a, b) => compare(a, b, sort.key, sort.dir))
              .map((r) => (
                <tr key={r.code} className="border-t first:border-t-0 hover:bg-surface-2/60">
                  <th scope="row" className="sticky left-0 z-10 max-w-[13rem] bg-card py-2 pr-3 pl-4 text-left font-semibold sm:max-w-none">
                    {r.footballOnly !== undefined ? (
                      <span>{r.name}</span>
                    ) : (
                      <Link href={`/trends/conferences/${r.slug}`} className="hover:text-primary hover:underline">
                        {r.name}
                      </Link>
                    )}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.footballOnly !== undefined ? <span className="text-xs text-muted-foreground">Football only · {r.footballOnly}</span> : r.members}
                  </td>
                  {r.tooFew ? (
                    <td colSpan={3} className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {r.footballOnly !== undefined ? "Members' main conferences differ" : `Too few members to summarize (under ${floor})`}
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">{r.acceptance === null ? "—" : formatBy("pct", r.acceptance)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.cost === null ? "—" : formatBy("money", r.cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.appsChange === null ? (
                          "—"
                        ) : (
                          <span className="inline-flex items-center gap-0.5">
                            {r.appsChange >= 0 ? <ArrowUp className="size-3 text-muted-foreground" aria-hidden /> : <ArrowDown className="size-3 text-muted-foreground" aria-hidden />}
                            {r.appsChange >= 0 ? "+" : "−"}
                            {formatBy("pct", Math.abs(r.appsChange))}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
