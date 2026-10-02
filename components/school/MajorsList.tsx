"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { num, pctSmart } from "@/lib/format";
import { cn } from "@/lib/utils";
import { matchesProgram } from "@/lib/majors";

/** One program, as the profile shows it (titles resolved on the server with lib/cip.ts). */
export interface MajorRow {
  /** CIP 2020 6-digit code, e.g. "11.0701". */
  cip: string;
  title: string;
  /** Short family name (lib/majors.ts), for search ("health" finds every health program). */
  family: string | null;
  /** First-major bachelor's. */
  first: number;
  /** Second-major bachelor's (counted separately). */
  second: number;
}

/**
 * "Most popular majors" (specs/data-expansion/majors.md): the top programs as bars (share of first-major graduates),
 * expandable to every program with a search box ("Do they have nursing?"). Rows are keyed by CIP code, so a later
 * version can expand a row into that program's earnings (field-of-study.md). Self-contained: the profile passes rows.
 */
export function MajorsList({ rows, total, color, top = 5 }: { rows: readonly MajorRow[]; total: number; color: string; top?: number }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const max = rows[0]?.first || 1;
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!open) return rows.filter((r) => r.first > 0).slice(0, top);
    if (!q) return rows;
    return rows.filter((r) => matchesProgram(r, q));
  }, [open, q, rows, top]);

  return (
    <div>
      {open && (
        <label className="mb-3 flex h-10 items-center gap-2 rounded-full border bg-background px-3.5 focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search programs, e.g. nursing"
            aria-label="Search this college's programs"
            aria-controls={listId}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </label>
      )}
      <ol id={listId} className={cn("space-y-2.5", open && "-mr-2 max-h-[28rem] overflow-y-auto pr-2")} aria-live={open ? "polite" : undefined}>
        {shown.map((r) => {
          const share = r.first / total;
          return (
            <li key={r.cip} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="break-words">{r.title}</span>{" "}
                  <span className="text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{r.cip}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {r.first > 0 ? (
                    <>
                      <b>{pctSmart(share)}</b> <span className="text-xs text-muted-foreground">{num(r.first)}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">second majors only</span>
                  )}
                </span>
              </div>
              {r.first > 0 && (
                <span className="mt-1 block h-1.5 rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.first / max) * 100)}%`, backgroundColor: color }} />
                </span>
              )}
              {open && r.second > 0 && (
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  +{num(r.second)} as a second major
                </span>
              )}
            </li>
          );
        })}
        {open && shown.length === 0 && (
          <li className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            No program here matches &ldquo;{query.trim()}&rdquo;. Programs go by their federal names, so try a broader word (&ldquo;health&rdquo;,
            &ldquo;engineering&rdquo;).
          </li>
        )}
      </ol>
      {rows.length > top && (
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            setQuery("");
          }}
          aria-expanded={open}
          className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
        >
          {open ? "Show the top programs" : `Show all ${num(rows.length)} programs and search`}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      )}
      {open && <p className="mt-2 text-[11px] text-muted-foreground">Shares are of the {num(total)} graduates&apos; first majors; a double major&apos;s other field is listed as a second major.</p>}
    </div>
  );
}
