/**
 * The workspace's list (specs/product/essays/workspace.md "Where it lives"): drafts grouped by college, the main essay
 * first, each a row with its count against the limit, its status, and how many comments are open. Rows on phones,
 * no sideways scroll. Server component.
 */
import Link from "next/link";
import { countLabel, countState } from "@/lib/essays/count";
import { KIND_LABEL } from "@/lib/essays/prompts";
import { rowLimit, STATUS_LABEL, type EssayGroup } from "@/lib/essays/rows";
import { suggestionNote } from "@/lib/essays/tab-view";
import { cn } from "@/lib/utils";

const STATUS_TONE = { draft: "bg-muted text-muted-foreground", ready: "bg-primary/15 text-primary", submitted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" } as const;
const COUNT_TONE = { none: "", ok: "", under: "text-amber-700 dark:text-amber-300", near: "text-amber-700 dark:text-amber-300", over: "text-destructive font-semibold" } as const;

export function EssayList({
  groups,
  openComments,
  openSuggestions = {},
  mySuggestions = {},
  viewer = "student",
  studentFirst = null,
  person,
  emptyLine,
}: {
  groups: EssayGroup[];
  openComments: Record<string, number>;
  /** Open suggestions per draft id (tab-view.ts `suggestionNote`); empty when the read didn't carry any. */
  openSuggestions?: Record<string, number>;
  /** A guardian's own newest suggestion's state per draft id. */
  mySuggestions?: Record<string, "open" | "decided">;
  /** Whose screen this is, for `suggestionNote`'s two readings. */
  viewer?: "student" | "guardian";
  /** The student's first name, for a guardian's "Waiting for {first}". */
  studentFirst?: string | null;
  person: string | null;
  emptyLine: string;
}) {
  const q = person ? `?for=${person}` : "";
  if (groups.every((g) => g.essays.length === 0)) {
    return <p className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">{emptyLine}</p>;
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h2 className="font-display text-lg font-bold">{g.label}</h2>
          {g.essays.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No drafts for {g.label} yet.</p>
          ) : (
            <ul className="mt-2 divide-y rounded-3xl border bg-card">
              {g.essays.map((e) => {
                const limit = rowLimit(e);
                const state = countState(e.count, limit);
                const open = openComments[e.id] ?? 0;
                const suggestion = suggestionNote(viewer, openSuggestions[e.id] ?? 0, mySuggestions[e.id], studentFirst);
                return (
                  <li key={`${g.key}:${e.id}`}>
                    <Link href={`/advisor/essays/${e.id}${q}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{e.title || KIND_LABEL[e.kind]}</span>
                        <span className={cn("block text-sm text-muted-foreground tabular-nums", COUNT_TONE[state])}>
                          {countLabel(e.count, limit, e.count_kind)}
                          {open > 0 ? ` · ${open} ${open === 1 ? "comment" : "comments"}` : ""}
                          {suggestion ? ` · ${suggestion}` : ""}
                        </span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_TONE[e.status])}>{STATUS_LABEL[e.status]}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export default EssayList;
