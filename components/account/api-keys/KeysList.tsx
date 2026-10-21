import type { ApiKeyRow } from "@/lib/api-keys-store";
import { usageLine, keyDate } from "@/lib/api-snippets";
import { cn } from "@/lib/utils";
import { RevokeKeyButton } from "./RevokeKeyButton";

// One grid for the header and every row. On a phone a key is a card (name, then Created / Last used / Today in three
// columns, then the action); from `sm` the cells line up as table columns.
const COLUMNS = "grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_7.5rem_9rem] sm:items-center sm:gap-x-4";

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-sm">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase sm:hidden">{label}</p>
      {children}
    </div>
  );
}

/**
 * The person's keys: name and prefix, created, last used, today's requests against the daily limit, and Revoke (with
 * a confirm step). Revoked keys come last (listMyApiKeys sorts them so) and are dimmed. Never shows a key itself, only
 * its prefix.
 */
export function KeysList({ rows, perDay }: { rows: ApiKeyRow[]; perDay: number }) {
  if (rows.length === 0)
    return <p className="rounded-xl bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground">You haven&apos;t made a key yet. Make one below.</p>;
  return (
    <div>
      <div className={cn(COLUMNS, "border-b pb-2 text-xs font-semibold text-muted-foreground max-sm:hidden")} aria-hidden>
        <span>Name</span>
        <span>Created</span>
        <span>Last used</span>
        <span>Requests today</span>
        <span />
      </div>
      <ul className="divide-y">
        {rows.map((k) => {
          const revoked = k.revoked_at !== null;
          return (
            <li key={k.id} className={cn(COLUMNS, "py-3", revoked && "opacity-60")}>
              <div className="col-span-3 min-w-0 sm:col-span-1">
                <p className="truncate text-sm font-semibold">{k.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{k.key_prefix}…</p>
              </div>
              <Cell label="Created">
                <span>{keyDate(k.created)}</span>
              </Cell>
              <Cell label="Last used">
                <span>{k.last_used_at ? keyDate(k.last_used_at) : "Never"}</span>
              </Cell>
              <Cell label="Requests today">
                <span className="tabular-nums">{revoked ? "–" : usageLine(k.used_today, perDay)}</span>
              </Cell>
              <div className="col-span-3 sm:col-span-1 sm:justify-self-end">
                {revoked ? (
                  <span className="text-sm text-muted-foreground">Revoked {keyDate(k.revoked_at!)}</span>
                ) : (
                  <RevokeKeyButton id={k.id} name={k.name} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
