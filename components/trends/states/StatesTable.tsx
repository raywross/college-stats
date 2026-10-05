"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatesTableRow {
  postal: string;
  name: string;
  territory: boolean;
  onSite: number;
  panel: number | null;
  tooFew: boolean;
  undergradChange: number | null;
  acceptanceRate: number | null;
  avgCost: number | null;
  outOfState: number | null;
  testOptionalShare: number | null;
}

type SortKey = keyof Pick<StatesTableRow, "name" | "onSite" | "undergradChange" | "acceptanceRate" | "avgCost" | "outOfState" | "testOptionalShare">;

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "State" },
  { key: "onSite", label: "Colleges", align: "right" },
  { key: "undergradChange", label: "Undergrad change", align: "right" },
  { key: "acceptanceRate", label: "Acceptance rate", align: "right" },
  { key: "avgCost", label: "Average cost", align: "right" },
  { key: "outOfState", label: "Out-of-state", align: "right" },
  { key: "testOptionalShare", label: "Test-optional", align: "right" },
];

const fmtPct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);
const fmtShare = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const fmtMoney = (v: number | null) => (v === null ? "—" : `$${v.toLocaleString("en-US")}`);

/**
 * The /trends/states index table (specs/trends/states.md): every state and territory, sortable, alphabetical by
 * default. States under STATE_FLOOR show their college count but "too few colleges to summarize" for every measure.
 */
export function StatesTable({ rows }: { rows: readonly StatesTableRow[] }) {
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<1 | -1>(1);
  const sorted = useMemo(() => {
    const withVal = rows.map((r) => ({ r, v: r[sort] }));
    return withVal
      .sort((a, b) => {
        if (a.v === null && b.v === null) return 0;
        if (a.v === null) return 1;
        if (b.v === null) return -1;
        if (typeof a.v === "string") return dir * String(a.v).localeCompare(String(b.v));
        return dir * ((a.v as number) - (b.v as number));
      })
      .map((x) => x.r);
  }, [rows, sort, dir]);

  const onSort = (key: SortKey) => {
    if (key === sort) setDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
    else {
      setSort(key);
      setDir(key === "name" ? 1 : -1);
    }
  };

  return (
    <div className="overflow-x-auto rounded-3xl border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b bg-surface-2 text-xs text-muted-foreground">
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 font-semibold", c.align === "right" ? "text-right" : "text-left", c.key === COLUMNS[0].key && "sticky left-0 z-10 bg-surface-2")}>
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  className={cn("inline-flex items-center gap-1 hover:text-foreground", c.align === "right" && "flex-row-reverse")}
                  aria-label={`Sort by ${c.label}`}
                >
                  {c.label}
                  {sort === c.key && (dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.postal} className="group border-b last:border-0 hover:bg-surface-2">
              {/* The state stays put while the measures scroll sideways on a phone. */}
              <td className="sticky left-0 z-10 bg-background px-3 py-2 group-hover:bg-surface-2">
                <Link href={`/trends/states/${r.postal.toLowerCase()}`} className="font-semibold hover:text-primary hover:underline">
                  {r.name}
                </Link>
                {r.territory && <span className="ml-1 text-[11px] text-muted-foreground">(territory)</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.onSite.toLocaleString("en-US")}</td>
              {r.tooFew ? (
                <td colSpan={5} className="px-3 py-2 text-right text-xs text-muted-foreground">
                  Too few colleges to summarize
                </td>
              ) : (
                <>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.undergradChange)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtShare(r.acceptanceRate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.avgCost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtShare(r.outOfState)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtShare(r.testOptionalShare)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
