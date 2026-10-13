import type { ReactNode } from "react";
import { StatusChips } from "@/components/admin/StatusChip";
import { Empty } from "@/components/admin/Panel";
import type { SearchRow } from "@/lib/admin/people";

/**
 * "Pick a person" without client JavaScript: a GET search form that reloads the page with `?<param>=<mode>&q=…`, then
 * the matches, each with the action the page offers for it. Used to add a student or a parent to a household, attach
 * a managed record to an account, and grant admin. The page runs the search (searchPeople) and passes the rows.
 */
export function PersonPicker({
  action,
  param,
  mode,
  q,
  label,
  rows,
  renderAction,
  keep = {},
}: {
  /** The page the form reloads. */
  action: string;
  /** The query parameter that says which picker is open (`add`, `attach`, `grant`). */
  param: string;
  mode: string;
  q: string;
  label: string;
  /** Matches, or null before anything has been searched. */
  rows: SearchRow[] | null;
  renderAction: (row: SearchRow) => ReactNode;
  /** Other parameters to carry through the reload. */
  keep?: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      <form action={action} method="get" className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name={param} value={mode} />
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="sr-only" htmlFor={`${param}-${mode}-q`}>
          {label}
        </label>
        <input
          id={`${param}-${mode}-q`}
          name="q"
          type="search"
          defaultValue={q}
          placeholder={label}
          autoComplete="off"
          className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-sm dark:bg-input/30"
        />
        <button type="submit" className="inline-flex h-11 items-center justify-center rounded-full border px-5 text-sm font-semibold hover:bg-muted">
          Search
        </button>
      </form>
      {rows !== null &&
        (rows.length === 0 ? (
          <Empty>No match. Try part of a name or email, or paste an id.</Empty>
        ) : (
          <ul className="divide-y rounded-xl border">
            {rows.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="break-words">{r.name ?? r.email ?? "No name"}</span>
                    <StatusChips status={r.status} />
                  </p>
                  {r.email && r.name && <p className="text-xs break-all text-muted-foreground">{r.email}</p>}
                  {r.household && <p className="text-xs text-muted-foreground">Household: {r.household}</p>}
                </div>
                <div className="sm:shrink-0">{renderAction(r)}</div>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
