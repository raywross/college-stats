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
 * list below it. No column ever carries `min-w-*`; a table that needs more room than `md` gets fewer columns, not a
 * sideways scroll. Server Component (no state): the two variants render once from the same `columns`/`rows`, so they
 * can never drift apart as a page's data changes.
 *
 * `rowKey` names the row for `<li>`/`<tr>` keys and for the card's `aria-label`. `caption` is the table's
 * `<caption className="sr-only">`; `empty` shows instead of either variant when `rows` is empty.
 */
export function ResponsiveTable<Row>({
  rows,
  columns,
  rowKey,
  empty,
  caption,
}: {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  empty: ReactNode;
  caption?: string;
}) {
  if (rows.length === 0) {
    return typeof empty === "string" ? <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{empty}</p> : <>{empty}</>;
  }

  const titleCol = columns.find((c) => c.role === "title") ?? columns[0];
  const factCols = columns.filter((c) => c !== titleCol && (c.role ?? "fact") === "fact");
  const actionCols = columns.filter((c) => c.role === "actions");
  const detailCols = columns.filter((c) => c.role === "detail");

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
              <tr key={rowKey(row)} className="border-t border-border align-top">
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

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-2xl border border-border bg-card p-4" aria-label={rowKey(row)}>
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
        ))}
      </ul>
    </>
  );
}
