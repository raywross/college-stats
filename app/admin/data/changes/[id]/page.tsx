import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Empty, Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { ChangeSetActions, ChangeSetChips, DocumentDiff, DocumentsTouched, ReleaseNoteDraft } from "@/components/admin/ChangeSets";
import { ChangeReport } from "@/components/admin/ChangeReport";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { collectionLabel } from "@/lib/admin/words";
import { adminSupabase } from "@/lib/admin/people";
import { documentBeforeAfter, loadChangeSet, parseDocumentParam, runRepo, touchedDocuments } from "@/lib/admin/data-reads";
import { changeSetActions, costLabel, countsLabel, diffHunks, documentLines, groupTouched, kindLabel, lineDiff, releaseNoteText, runHref, summaryText } from "@/lib/admin/change-set-view";

export const metadata: Metadata = { title: "Change", robots: { index: false, follow: false } };

/**
 * `/admin/data/changes/[id]` (specs/data-platform/change-sets.md "The console", Change sets row; "Holds and
 * review"; "Revert"; specs/product/admin-redesign.md "Data"): the change's summary and reason, its report as a list of
 * counts and checks with the raw text under Details, the documents it touched grouped by collection, the before and
 * after of one of them (`?c=<collection>&k=<key>`) as a line diff, and its actions: Hold, Publish anyway, Undo this
 * change (with one sentence linking Published versions, the other undo), and Write a release note.
 */
export default async function ChangeSetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const raw = (await params).id;
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : null;
  if (id === null || id < 1) notFound();
  const query = await searchParams;
  const supabase = await adminSupabase();
  const row = await loadChangeSet(supabase, id);
  if (!row) notFound();

  const selected = parseDocumentParam(query.c, query.k);
  const [touched, chosen] = await Promise.all([touchedDocuments(supabase, id), selected ? documentBeforeAfter(supabase, id, selected.collection, selected.key) : Promise.resolve(null)]);
  const groups = groupTouched(touched.rows);
  const run = runHref(row.run_ref, runRepo());
  const report = summaryText(row.summary);
  const cost = costLabel(row.summary);
  const can = changeSetActions(row);

  return (
    <>
      <PageHeader help="change"
        title={`Change #${row.id}`}
        chips={<ChangeSetChips row={row} />}
        back={
          <Link href="/admin/data/changes" className="underline decoration-dotted underline-offset-2">
            Changes
          </Link>
        }
        subtitle={`${kindLabel(row.kind)} · ${row.source}`}
      />
      <div className="space-y-5">
        {row.status === "held" && (
          <div role="note" className="rounded-2xl border border-warning bg-warning/10 p-4 text-sm">
            <p className="font-semibold">Held: nothing from this change or any later one publishes until it is published anyway or undone.</p>
            <p className="mt-1">{row.held_reason ?? "No reason recorded."}</p>
          </div>
        )}

        <Panel help="change" title="Summary">
          <Fields
            items={[
              { label: "Documents", value: countsLabel(row.summary) },
              { label: "What it touched", value: Array.isArray(row.summary?.collections) && row.summary.collections.length ? row.summary.collections.map(collectionLabel).join(", ") : "—" },
              { label: "Started", value: fmtDateTime(row.created_at) },
              { label: "Closed", value: row.closed_at ? fmtDateTime(row.closed_at) : "Still writing" },
              ...(cost ? [{ label: "Cost", value: cost }] : []),
              {
                label: "Run",
                value: run ? (
                  <a href={run} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
                    Run {row.run_ref} on GitHub
                  </a>
                ) : (
                  (row.run_ref ?? "—")
                ),
              },
              ...(row.snapshot_id !== null ? [{ label: "Published in", value: `Version ${row.snapshot_id}` }] : []),
              ...(row.reverted_by !== null
                ? [
                    {
                      label: "Undone by",
                      value: (
                        <Link href={`/admin/data/changes/${row.reverted_by}`} className="underline decoration-dotted underline-offset-2">
                          Change #{row.reverted_by}
                        </Link>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Panel>

        {report && (
          <Panel help="change-report" title="Report">
            <ChangeReport text={report} />
          </Panel>
        )}

        <Panel help="change-actions" title="Actions">
          <ChangeSetActions row={row} />
          {can.revert && (
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">
              To undo a whole publish rather than this one change,{" "}
              <Link href="/admin/data/versions" className="font-semibold text-primary underline-offset-4 hover:underline">
                make an earlier published version live
              </Link>
              .
            </p>
          )}
          {can.releaseNote && (
            <div className="mt-4">
              <ReleaseNoteDraft note={releaseNoteText(row)} />
            </div>
          )}
        </Panel>

        <Panel help="documents-touched" title="Documents touched">
          <DocumentsTouched id={row.id} groups={groups} selected={selected} truncated={touched.truncated} />
        </Panel>

        {selected && (
          <Panel help="documents-touched" title={`${collectionLabel(selected.collection)} · ${selected.key}`} id="document">
            {!chosen ? (
              <Empty>This change didn&apos;t touch that document.</Empty>
            ) : (
              <DocumentDiff
                hunks={diffHunks(lineDiff(documentLines(chosen.before && !chosen.before.deleted ? chosen.before.body : null), documentLines(chosen.after.deleted ? null : chosen.after.body)))}
                beforeVersion={chosen.before?.version ?? null}
                afterVersion={chosen.after.version}
                deleted={chosen.after.deleted}
              />
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
