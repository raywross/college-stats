import Link from "next/link";
import { actionLabel, fmtDateTime, logHref, targetHref } from "@/lib/admin/console";
import type { AdminLogRow } from "@/lib/admin/people";

/**
 * Log rows as a list: when, who, what, on what, and the recorded details behind a "Details" disclosure (they hold no
 * tokens, links, or passwords; emails appear only in an email change's old and new). A stacked layout so it reads
 * on a phone as well as a desk.
 */
export function LogRows({ rows }: { rows: AdminLogRow[] }) {
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {rows.map((r) => {
        const target = targetHref(r.target_kind, r.target_id);
        const hasDetails = r.details && Object.keys(r.details).length > 0;
        return (
          <li key={r.id} className="space-y-1 p-3.5 text-sm sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <p className="font-semibold">{actionLabel(r.action)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(r.at)}</p>
            </div>
            <p className="text-muted-foreground">
              {r.admin_id ? (
                <Link href={logHref({ adminId: r.admin_id })} className="underline underline-offset-4 hover:text-foreground">
                  {r.admin_name ?? "An admin"}
                </Link>
              ) : (
                "The system"
              )}
              {r.target_kind && (
                <>
                  {" · "}
                  {target ? (
                    <Link href={target} className="underline underline-offset-4 hover:text-foreground">
                      {r.target_kind}
                    </Link>
                  ) : (
                    r.target_kind
                  )}
                  {r.target_id && <span className="font-mono text-xs"> {r.target_id.slice(0, 8)}</span>}
                </>
              )}
              <span className="font-mono text-xs"> · {r.action}</span>
            </p>
            {hasDetails && (
              <details className="text-xs">
                <summary className="inline-flex min-h-8 cursor-pointer items-center text-muted-foreground hover:text-foreground">Details</summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">{JSON.stringify(r.details, null, 2)}</pre>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
