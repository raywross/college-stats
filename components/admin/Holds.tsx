import Link from "next/link";
import { Empty } from "@/components/admin/Panel";
import type { HeldEssay } from "@/lib/admin/review-queue";
import { documentLabel, safeHref } from "@/lib/admin/ops-view";
import { ESSAY_STATUS_LABELS } from "@/lib/admin/essays";
import { codeWordsInText } from "@/lib/admin/words";

/*
 * What is left of Holds (specs/product/admin-redesign.md "Owner decisions" 2: Holds is no longer a screen): the essay
 * reader's held records, listed on the Essays page. Held review items are decided on a college's Review page, held
 * changes on Changes and the Inbox.
 */

const FAILURES_SHOWN = 3;
const linkCls = "underline decoration-dotted underline-offset-2";

function listsLabel(n: number | undefined): string | null {
  return n ? `on ${n} ${n === 1 ? "list" : "lists"}` : null;
}

function Document({ url }: { url: string | undefined }) {
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`break-all ${linkCls}`}>
      {documentLabel(url)}
    </a>
  ) : (
    <span className="text-muted-foreground">{documentLabel(url)}</span>
  );
}

/**
 * The essay reader's held records: the run read the college's page but its checks held the questions. Each links to
 * the college's hand-read form (/admin/data/essays/[unit]), where a saved read is live at once.
 */
export function HeldEssaysList({ records, lists }: { records: HeldEssay[]; lists: ReadonlyMap<string, number> | null }) {
  if (!records.length) return <Empty>No essay questions are held.</Empty>;
  return (
    <ul className="divide-y rounded-2xl border bg-background" aria-label="Held essay questions">
      {records.map((r) => {
        const listed = listsLabel(lists?.get(r.unit_id));
        const page = typeof r.record?.url === "string" ? r.record.url : undefined;
        return (
          <li key={r.unit_id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3" data-unit={r.unit_id}>
            <span className="min-w-0 space-y-0.5">
              <span className="block font-semibold break-words">{r.name}</span>
              <span className="block text-xs text-muted-foreground">
                {r.unit_id} · held {r.held}
                {listed ? ` · ${listed}` : ""}
              </span>
              {r.problems.length > 0 && (
                <span className="block text-xs" title={r.problems.slice(0, FAILURES_SHOWN).join("; ")}>
                  {r.problems
                    .slice(0, FAILURES_SHOWN)
                    .map((p) => codeWordsInText(p, ESSAY_STATUS_LABELS))
                    .join("; ")}
                </span>
              )}
              {page && (
                <span className="block text-xs">
                  <Document url={page} />
                </span>
              )}
            </span>
            <Link href={`/admin/data/essays/${r.unit_id}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
              Enter the questions
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
