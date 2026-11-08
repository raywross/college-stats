import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { StatusChip } from "@/components/admin/StatusChip";
import { Empty } from "@/components/admin/Panel";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { CopyButton } from "@/components/api/CopyButton";
import { fmtDateTime } from "@/lib/admin/console";
import { collectionLabel } from "@/lib/admin/words";
import {
  changeSetActions,
  costLabel,
  countsLabel,
  kindLabel,
  runHref,
  statusLabel,
  statusTone,
  type ChangeSetRow,
  type DiffHunk,
} from "@/lib/admin/change-set-view";
import { CONFIRM_UNDO } from "@/lib/admin/data-actions";
import { holdChangeSetAction, publishAnywayAction, revertChangeSetAction } from "@/app/admin/data/actions";

const linkCls = "underline decoration-dotted underline-offset-2";

/** A change set's status as a chip, plus "Published in snapshot N" or "Reverted by #N" when it applies. */
export function ChangeSetChips({ row }: { row: ChangeSetRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusChip label={statusLabel(row.status)} tone={statusTone(row.status)} help={row.status === "held" ? "held" : undefined} />
      {row.snapshot_id !== null && <StatusChip label={`In published version ${row.snapshot_id}`} tone="info" />}
      {row.reverted_by !== null && <StatusChip label={`Undone by #${row.reverted_by}`} tone="neutral" />}
    </span>
  );
}

/**
 * `/admin/data/changes` (specs/data-platform/change-sets.md "The console", Changes row), through `ResponsiveTable`:
 * newest first, each with its status, source, counts, cost, and run link.
 */
export function ChangeSetsTable({ rows, repo }: { rows: ChangeSetRow[]; repo: string }) {
  const columns: readonly Column<ChangeSetRow>[] = [
    {
      key: "change",
      header: "Change",
      role: "title",
      cell: (row) => (
        <>
          <Link href={`/admin/data/changes/${row.id}`} className={linkCls}>
            #{row.id}
          </Link>
          <div className="text-xs font-normal text-muted-foreground">{fmtDateTime(row.created_at)}</div>
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <>
          <ChangeSetChips row={row} />
          {row.held_reason && <div className="mt-1 text-xs text-muted-foreground">{row.held_reason}</div>}
        </>
      ),
    },
    {
      key: "source",
      header: "Source",
      cell: (row) => (
        <>
          {row.source}
          <div className="text-xs text-muted-foreground">{kindLabel(row.kind)}</div>
        </>
      ),
    },
    { key: "documents", header: "Documents", cell: (row) => countsLabel(row.summary) },
    { key: "cost", header: "Cost", role: "detail", cell: (row) => costLabel(row.summary) ?? "—" },
    {
      key: "run",
      header: "Run",
      role: "detail",
      cell: (row) => {
        const run = runHref(row.run_ref, repo);
        return run ? (
          <a href={run} target="_blank" rel="noopener noreferrer" className={linkCls}>
            Run {row.run_ref}
          </a>
        ) : (
          <span className="text-muted-foreground">{row.run_ref ?? "—"}</span>
        );
      },
    },
  ];
  return <ResponsiveTable rows={rows} columns={columns} rowKey={(row) => String(row.id)} caption="Changes, newest first" empty="No changes match." />;
}

/**
 * A change set's actions (specs/data-platform/change-sets.md "The console"): Hold (a reason), Publish anyway, and
 * Revert (typed confirmation). Each is offered only when the set's status allows it; the functions check again.
 */
export function ChangeSetActions({ row }: { row: ChangeSetRow }) {
  const can = changeSetActions(row);
  const id = String(row.id);
  if (!can.hold && !can.publishAnyway && !can.revert) return <Empty>No actions: {row.status === "open" ? "the run is still writing." : "this change is settled."}</Empty>;
  return (
    <div className="flex flex-wrap items-start gap-3">
      {can.publishAnyway && (
        <AdminForm
          action={publishAnywayAction}
          hidden={{ change_set: id }}
          trigger="Publish anyway"
          tone="primary"
          pendingLabel="Publishing…"
          description="Releases the hold and starts the publish, so this change and everything after it go live."
        />
      )}
      {can.hold && (
        <AdminForm
          action={holdChangeSetAction}
          hidden={{ change_set: id }}
          trigger="Hold"
          fields={[{ name: "reason", label: "Why hold it", type: "textarea", required: true, maxLength: 500 }]}
          description="The automatic publish stops at this change, and every later one, until it is published anyway or undone."
        />
      )}
      {can.revert && (
        <AdminForm
          action={revertChangeSetAction}
          hidden={{ change_set: id }}
          trigger="Undo this change"
          tone="danger"
          fields={[{ name: "note", label: "Note (optional)", type: "textarea", maxLength: 500 }]}
          typed={{ expected: CONFIRM_UNDO, instruction: <>Type &ldquo;{CONFIRM_UNDO}&rdquo; to confirm</> }}
          description="Writes a new change that puts back every document this one changed. The next publish carries it; to undo a whole publish at once, make an earlier published version live instead. Refused when a later change changed the same documents: undo that one first."
        />
      )}
    </div>
  );
}

/** The documents a change set touched, by collection, each a link to its before and after. */
export function DocumentsTouched({
  id,
  groups,
  selected,
  truncated,
}: {
  id: number;
  groups: { collection: string; documents: { key: string; deleted: boolean }[] }[];
  selected: { collection: string; key: string } | null;
  truncated: boolean;
}) {
  if (!groups.length) return <Empty>This change wrote no documents.</Empty>;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <details key={g.collection} open={groups.length === 1 || selected?.collection === g.collection} className="rounded-xl border border-border">
          <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm">
            <span className="font-semibold">{collectionLabel(g.collection)}</span>{" "}
            <span className="text-muted-foreground">
              · {g.documents.length.toLocaleString("en-US")} document{g.documents.length === 1 ? "" : "s"}
            </span>
          </summary>
          <ul className="flex flex-wrap gap-1.5 border-t border-border p-3 text-xs">
            {g.documents.map((d) => {
              const on = selected?.collection === g.collection && selected.key === d.key;
              const href = `/admin/data/changes/${id}?c=${encodeURIComponent(g.collection)}&k=${encodeURIComponent(d.key)}#document`;
              return (
                <li key={d.key}>
                  <Link href={href} aria-current={on ? "true" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-2.5 font-mono ${on ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
                    {d.key}
                    {d.deleted && <span className="ml-1 text-destructive">(removed)</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
      {truncated && <p className="text-xs text-muted-foreground">Only the first documents are listed; the counts above are the whole change&apos;s.</p>}
    </div>
  );
}

/** One document's before and after as a line diff of its JSON, unchanged runs collapsed. */
export function DocumentDiff({ hunks, beforeVersion, afterVersion, deleted }: { hunks: DiffHunk[]; beforeVersion: number | null; afterVersion: number; deleted: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {beforeVersion === null ? "Created by this change" : `Version ${beforeVersion}`} → version {afterVersion}
        {deleted ? " (removed)" : ""}
      </p>
      {!hunks.some((h) => "lines" in h && h.lines.some((l) => l.op !== "same")) ? (
        <Empty>No difference in the document&apos;s content.</Empty>
      ) : (
        <pre className="max-h-[32rem] overflow-auto rounded-xl border border-border bg-muted/30 p-3 font-mono text-xs leading-5">
          {hunks.map((h, i) =>
            "skipped" in h ? (
              <span key={i} className="block text-muted-foreground">
                {`  … ${h.skipped} unchanged line${h.skipped === 1 ? "" : "s"}`}
              </span>
            ) : (
              h.lines.map((l, j) => (
                <span
                  key={`${i}-${j}`}
                  className={`block whitespace-pre ${l.op === "add" ? "bg-emerald-500/15 text-emerald-900 dark:text-emerald-200" : l.op === "del" ? "bg-destructive/10 text-destructive" : ""}`}
                >
                  {`${l.op === "add" ? "+" : l.op === "del" ? "-" : " "} ${l.text}`}
                </span>
              ))
            ),
          )}
        </pre>
      )}
    </div>
  );
}

/**
 * Write a release note (specs/data-platform/change-sets.md "A run, start to finish", step 4): the note's text to copy
 * into `release-notes/<slug>.md` in a code change. The console commits nothing.
 */
// TODO(lead): a "Write a release note" that opens the note as a code PR through the GitHub App needs a code-PR path in
// lib/github-app.ts; nothing else used `commitFileAndOpenPull` once the review queue moved to the store, so it was
// removed. Restore a narrow `release-notes/*.md`-only version if the owner wants the button to commit the note.
export function ReleaseNoteDraft({ note }: { note: { path: string; content: string } }) {
  return (
    <details className="rounded-xl border border-border">
      <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold">Write a release note</summary>
      <div className="space-y-2 border-t border-border p-3">
        <p className="text-sm text-muted-foreground">
          Routine refreshes don&apos;t need one. To write one, save this as <span className="font-mono">{note.path}</span> in a code change and fill in its number.
        </p>
        <CopyButton text={note.content} label="Copy the note" />
        <pre className="max-h-80 overflow-auto rounded-xl bg-muted/30 p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{note.content}</pre>
      </div>
    </details>
  );
}
