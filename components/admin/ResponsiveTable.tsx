import type { ReactNode } from "react";
import type { HelpKey } from "@/lib/admin/help";
import { HelpTip } from "@/components/admin/HelpTip";
import { cn } from "@/lib/utils";

/**
 * One column of a `ResponsiveTable`. `role` says how the column behaves below `md`, where there is no table at all:
 * - `"title"` (at most one; the first if none is marked): the card's heading.
 * - `"fact"` (the default): one wrapped line "Header: value".
 * - `"actions"`: rendered as a row of 44 px buttons at the bottom of the card (and still its own `<td>` from `md`).
 * - `"detail"`: folded inside the card's `<details>Details</details>`, after the facts.
 */
export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  role?: "title" | "fact" | "actions" | "detail";
  align?: "left" | "right";
  help?: HelpKey;
}

/**
 * The console's one table component (specs/product/admin-redesign.md "Phones"): a real `<table>` from `md`, a card
 * list below it. No column ever carries a minimum width; a table that needs more room than `md` gets fewer columns, not a
 * sideways scroll. Server Component (no state): the two variants render once from the same `columns`/`rows`, so they
 * can never drift apart as a page's data changes.
 *
 * `rowKey` names the row for `<li>`/`<tr>` keys and for the card's `aria-label`. `caption` is the table's
 * `<caption className="sr-only">`; `empty` shows instead of either variant when `rows` is empty.
 *
 * A long list folds on the phone: past `foldAfter` rows (`FOLD_AFTER` unless given), the first `foldAfter` cards show
 * and the rest wait inside one `<details>` whose 44 px summary says "Show the other N". The table from `md` always
 * shows every row. Native `<details>`, so the fold needs no state and the page stays a Server Component.
 */
/** Cards shown on a phone before the rest fold under "Show the other N". */
export const FOLD_AFTER = 25;

export function ResponsiveTable<Row>({
  rows,
  columns,
  rowKey,
  empty,
  caption,
  rowAttrs,
  foldAfter = FOLD_AFTER,
}: {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  empty: ReactNode;
  caption?: string;
  /** Optional per-row extras on the `<tr>` and the card: a `data-outcome` marker and a tint class. */
  rowAttrs?: (row: Row) => { outcome?: string; className?: string } | undefined;
  /** Below `md`, how many cards show before the rest fold into "Show the other N" (default `FOLD_AFTER`). */
  foldAfter?: number;
}) {
  if (rows.length === 0) {
    return typeof empty === "string" ? <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{empty}</p> : <>{empty}</>;
  }

  const titleCol = columns.find((c) => c.role === "title") ?? columns[0];
  const factCols = columns.filter((c) => c !== titleCol && (c.role ?? "fact") === "fact");
  const actionCols = columns.filter((c) => c.role === "actions");
  const detailCols = columns.filter((c) => c.role === "detail");
  const shown = Math.max(1, Math.floor(foldAfter));
  const [first, rest] = rows.length > shown ? [rows.slice(0, shown), rows.slice(shown)] : [rows, []];

  const card = (row: Row) => (
    <li key={rowKey(row)} data-outcome={rowAttrs?.(row)?.outcome} className={cn("rounded-2xl border border-border bg-card p-4", rowAttrs?.(row)?.className)} aria-label={rowKey(row)}>
      <div className="min-w-0 font-semibold break-words">{titleCol.cell(row)}</div>
      {factCols.length > 0 && (
        <dl className="mt-2 space-y-1 text-sm">
          {factCols.map((c) => {
            const value = c.cell(row);
            if (value === null || value === undefined || value === "") return null;
            return (
              <div key={c.key} className="flex flex-wrap gap-x-1.5">
                <dt className="shrink-0 text-muted-foreground">
                  {c.header}
                  {c.help && <HelpTip help={c.help} />}:
                </dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {detailCols.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="min-h-11 cursor-pointer py-1.5 font-semibold">Details</summary>
          <dl className="space-y-1 pb-1">
            {detailCols.map((c) => (
              <div key={c.key} className="flex flex-wrap gap-x-1.5">
                <dt className="shrink-0 text-muted-foreground">{c.header}:</dt>
                <dd className="min-w-0 break-words">{c.cell(row)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {actionCols.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actionCols.map((c) => (
            <div key={c.key} className="contents">
              {c.cell(row)}
            </div>
          ))}
        </div>
      )}
    </li>
  );

  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-border md:block">
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2 font-medium", c.align === "right" && "text-right")}>
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {c.help && <HelpTip help={c.help} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} data-outcome={rowAttrs?.(row)?.outcome} className={cn("border-t border-border align-top", rowAttrs?.(row)?.className)}>
                {columns.map((c) =>
                  c === titleCol ? (
                    <th key={c.key} scope="row" className="px-3 py-2 text-left font-medium">
                      {c.cell(row)}
                    </th>
                  ) : (
                    <td key={c.key} className={cn("px-3 py-2", c.align === "right" && "text-right")}>
                      {c.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden">
        <ul className="space-y-3">{first.map(card)}</ul>
        {rest.length > 0 && (
          <details className="mt-3" data-fold>
            <summary className="flex min-h-11 cursor-pointer items-center rounded-2xl border border-dashed border-border px-4 text-sm font-semibold">
              Show the other {rest.length.toLocaleString("en-US")}
            </summary>
            <ul className="mt-3 space-y-3">{rest.map(card)}</ul>
          </details>
        )}
      </div>
    </>
  );
}
