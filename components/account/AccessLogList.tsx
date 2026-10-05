import { groupAccessLog, type AccessLogRow } from "@/lib/household-rules";

/** "Mom viewed your list on Oct 2": the student's view of guardian reads (my_access_log), one line per viewer, thing, and day. */
export function AccessLogList({ rows, limit = 20 }: { rows: AccessLogRow[]; limit?: number }) {
  const lines = groupAccessLog(rows);
  if (lines.length === 0) {
    return <p className="rounded-xl bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground">No guardian has viewed your information yet.</p>;
  }
  return (
    <ul className="divide-y text-sm">
      {lines.slice(0, limit).map((l) => (
        <li key={`${l.viewer}|${l.what}|${l.day}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2.5">
          <span className="min-w-0">
            <span className="font-semibold">{l.viewer}</span> viewed {l.what}
            {l.count > 1 && <span className="text-muted-foreground"> ({l.count} times)</span>}
          </span>
          <span className="shrink-0 text-muted-foreground">{l.day}</span>
        </li>
      ))}
    </ul>
  );
}
