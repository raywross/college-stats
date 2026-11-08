import type { ReactNode } from "react";
import { ConfirmTyped } from "@/components/admin/ConfirmTyped";
import { HelpTip } from "@/components/admin/HelpTip";
import { Empty, Muted, Panel } from "@/components/admin/Panel";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { keepDocumentAction } from "@/app/admin/data/colleges/[unit]/actions";
import { CONFIRM_KEEP } from "@/lib/admin/console";
import {
  collisions,
  compareDocuments,
  documentFacts,
  factsSentence,
  filedWords,
  findDocument,
  keepSentence,
  sizeWords,
  type DifferRow,
  type DocumentFacts,
  type OnlyRow,
} from "@/lib/admin/document-compare";
import type { CollegeDocuments } from "@/lib/admin/document-reads";
import { editionLabel } from "@/lib/admin/words";
import { compareDocuments as newestFirst } from "@/lib/cds-records";
import type { DocumentRecord, TemplateTable } from "@/lib/cds-sections";

/**
 * The college page's Documents panel (specs/product/document-collisions.md "The college page's Documents panel"): one
 * card per CDS document with its facts in a sentence and the rest under Details; and, when two files claim one edition
 * or the page was opened with `?compare=<a>,<b>`, the two files side by side (stacked below `md`), what differs between
 * them, and Keep this file under each. Server Component; Keep this file is the typed `ConfirmTyped` (a sheet on phones).
 */
export function DocumentsPanel({ unit, docs, compare, template }: { unit: string; docs: CollegeDocuments | null; compare: [string, string] | null; template: Pick<TemplateTable, "items" | "byCode"> }) {
  const documents = docs?.record ? [...docs.record.documents].sort(newestFirst) : [];
  const facts = (d: DocumentRecord) => documentFacts(d, docs?.manifest.get(d.sha256) ?? null, template);
  const pair = pairToCompare(docs, compare);
  const clashes = collisions(docs?.record);
  return (
    <Panel
      help="documents"
      title="Documents"
      id="documents"
      aside={docs?.record ? <Muted>{documents.length === 1 ? "1 file" : `${documents.length} files`}{clashes.length ? ` · ${clashes.length === 1 ? "a collision" : `${clashes.length} collisions`}` : ""}</Muted> : undefined}
    >
      {docs === null ? (
        <Empty>Couldn&apos;t read this college&apos;s Common Data Set record. Reload the page to try again.</Empty>
      ) : documents.length === 0 ? (
        <Empty>No Common Data Set file is on record for this college.</Empty>
      ) : (
        <div className="space-y-5">
          {pair && <CompareBlock unit={unit} a={pair[0]} b={pair[1]} docs={docs} template={template} more={pair[2]} />}
          <ul className="space-y-3">
            {documents.map((d) => (
              <li key={d.sha256} className="min-w-0 rounded-xl border border-border p-3 text-sm">
                <p className="font-semibold">
                  {editionLabel(d.edition)} · {facts(d).source.host}
                </p>
                <FileFacts f={facts(d)} queue={docs.queue.get(d.sha256) ?? 0} doc={d} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/**
 * The two files to show side by side: the `?compare=` pair when both are on the record, else the first collision's two
 * newest pulls; the third value is how many more files claim that edition.
 */
export function pairToCompare(docs: CollegeDocuments | null, compare: [string, string] | null): [DocumentRecord, DocumentRecord, number] | null {
  const record = docs?.record;
  if (!record) return null;
  if (compare) {
    const [a, b] = [findDocument(record, compare[0]), findDocument(record, compare[1])];
    if (a && b && a !== b) return [a, b, 0];
  }
  const first = collisions(record)[0];
  return first ? [first.documents[0], first.documents[1], first.documents.length - 2] : null;
}

function FileFacts({ f, queue, doc }: { f: DocumentFacts; queue: number; doc: DocumentRecord }) {
  const reads = Object.entries(doc.reads ?? {}).filter(([, r]) => !!r);
  return (
    <div className="min-w-0 space-y-2">
      <p className="break-words">{factsSentence(f)}</p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
        <span>
          {f.coverLine ? `The file itself: ${f.coverLine}. ` : ""}
          {queue.toLocaleString("en-US")} review-queue item{queue === 1 ? "" : "s"}.
        </span>
      </p>
      <details className="rounded-lg border border-border">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold">Details</summary>
        <dl className="space-y-1.5 border-t border-border p-3">
          <Fact label="Pulled from" help="pulled-from">
            <a href={f.source.url} target="_blank" rel="noreferrer" className="break-all underline-offset-2 hover:underline">
              {f.source.url}
            </a>
          </Fact>
          {f.source.finalUrl && (
            <Fact label="Which led to">
              <span className="break-all">{f.source.finalUrl}</span>
            </Fact>
          )}
          <Fact label="Filed" help="filed-by">
            {filedWords(f)}
          </Fact>
          <Fact label="File">
            <span className="font-mono text-[13px] break-all">{f.sha256}</span>
          </Fact>
          {(f.pages !== null || f.bytes !== null) && <Fact label="Size">{[f.pages !== null ? `${f.pages} pages` : null, sizeWords(f.bytes)].filter(Boolean).join(", ")}</Fact>}
          {reads.map(([part, r]) => (
            <Fact key={part} label={part === "deterministic" ? "Read" : `Read (${part === "C" ? "section C" : "the rest"})`}>
              {r!.read_by}, {r!.mode}, {(r!.extracted ?? "").slice(0, 10)}
            </Fact>
          ))}
        </dl>
      </details>
    </div>
  );
}

function Fact({ label, help, children }: { label: string; help?: "pulled-from" | "filed-by"; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-1.5">
      <dt className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
        {label}
        {help && <HelpTip help={help} />}:
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function CompareBlock({ unit, a, b, docs, template, more }: { unit: string; a: DocumentRecord; b: DocumentRecord; docs: CollegeDocuments; template: Pick<TemplateTable, "items" | "byCode">; more: number }) {
  const [fa, fb] = [documentFacts(a, docs.manifest.get(a.sha256) ?? null, template), documentFacts(b, docs.manifest.get(b.sha256) ?? null, template)];
  const cmp = compareDocuments(a, b, template);
  const same = a.edition === b.edition;
  const title = same ? `Two files claim ${editionLabel(a.edition)}` : "Compare two files";
  const files = [
    { label: "File A", doc: a, f: fa, other: fb, otherDoc: b },
    { label: "File B", doc: b, f: fb, other: fa, otherDoc: a },
  ];
  const columns: readonly Column<DifferRow>[] = [
    { key: "item", header: "Item", role: "title", cell: (r) => r.label },
    { key: "a", header: "File A", cell: (r) => r.a },
    { key: "b", header: "File B", cell: (r) => r.b },
  ];
  return (
    <section aria-labelledby="collision-title" className="min-w-0 space-y-4 rounded-2xl border-2 border-amber-500/40 p-3 sm:p-4">
      <div className="space-y-1">
        <h3 id="collision-title" className="inline-flex items-center gap-1.5 text-base font-bold">
          {title}
          <HelpTip help="document-collision" />
        </h3>
        <p className="text-sm text-muted-foreground">
          {same
            ? `Both files are filed under ${editionLabel(a.edition)}. Read when and where each was pulled, then keep one; the other is dropped.`
            : `File A is filed under ${editionLabel(a.edition)}, File B under ${editionLabel(b.edition)}. Keep one; the other is dropped.`}
          {more > 0 ? ` ${more} more file${more === 1 ? "" : "s"} claim${more === 1 ? "s" : ""} it too; they are listed below.` : ""}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {files.map(({ label, doc, f, other, otherDoc }) => {
          const queue = docs.queue.get(otherDoc.sha256) ?? 0;
          return (
            <article key={doc.sha256} aria-label={label} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3 text-sm">
              <h4 className="font-semibold">
                {label}: {f.source.host}, pulled {f.retrieved}
              </h4>
              <FileFacts f={f} queue={docs.queue.get(doc.sha256) ?? 0} doc={doc} />
              <div className="flex items-start gap-1.5">
                <ConfirmTyped
                  action={keepDocumentAction}
                  hidden={{ unit, keep: doc.sha256, drop: otherDoc.sha256 }}
                  trigger="Keep this file"
                  expected={CONFIRM_KEEP}
                  sheet
                  description={keepSentence(other, queue)}
                />
                <HelpTip help="keep-file" className="mt-3" />
              </div>
            </article>
          );
        })}
      </div>
      <div className="space-y-2">
        <h4 className="inline-flex items-center gap-1.5 font-semibold">What differs</h4>
        <p className="text-sm">
          {cmp.agree.toLocaleString("en-US")} item{cmp.agree === 1 ? "" : "s"} read in both agree; {cmp.differ.length.toLocaleString("en-US")} differ. File A has {cmp.failuresA.toLocaleString("en-US")} item
          {cmp.failuresA === 1 ? "" : "s"} with check failures, File B {cmp.failuresB.toLocaleString("en-US")}.
        </p>
        <ResponsiveTable rows={cmp.differ} columns={columns} rowKey={(r) => r.code} caption="Items the two files read differently" empty="No item both files read has a different value." />
        <details className="rounded-lg border border-border text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold">
            Only one file read it: {cmp.onlyA.length.toLocaleString("en-US")} in File A, {cmp.onlyB.length.toLocaleString("en-US")} in File B
          </summary>
          <div className="grid gap-3 border-t border-border p-3 md:grid-cols-2">
            <OnlyList title="Only in File A" rows={cmp.onlyA} />
            <OnlyList title="Only in File B" rows={cmp.onlyB} />
          </div>
        </details>
      </div>
    </section>
  );
}

function OnlyList({ title, rows }: { title: string; rows: OnlyRow[] }) {
  return (
    <div className="min-w-0">
      <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h5>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">None</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {rows.map((r) => (
            <li key={r.code} className="break-words">
              {r.label}: {r.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
