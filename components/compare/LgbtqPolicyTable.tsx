import type { School } from "@/lib/types";
import type { ComparedChecklistRow } from "@/lib/lgbtq-policy";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { Block } from "@/components/profile/Panel";
import { COMPARE_BLOCK_SCROLL } from "./CompareTopicPage";

const LABEL_CELL =
  "sticky left-0 z-10 max-w-36 bg-card px-3 py-2.5 text-muted-foreground shadow-[1px_0_0_var(--border)] sm:max-w-none sm:px-4 sm:shadow-none";

/**
 * The LGBTQ+ policy checklist, side by side (specs/lgbtq-life.md "Where it appears": "the checklist rows side by
 * side, each cell dated"), from `comparedChecklist(schools, details)`. Moved verbatim from the single compare page:
 * national-directory leads and, once checked, a college's own verified facts, each cell already carrying its own
 * link and date — never the gender-identity counts, which have no Compare row. Hidden entirely when no compared
 * college has anything to show (a key missing for a college isn't "no": nothing was found for it).
 */
export function LgbtqPolicyTable({ schools, rows }: { schools: School[]; rows: ComparedChecklistRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Block id="lgbtq" className={COMPARE_BLOCK_SCROLL} title="LGBTQ+ policies">
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        Each item is dated: either the college&apos;s own page, checked on that date, or a national list&apos;s claim, read on
        that date &mdash; never a plain &ldquo;yes&rdquo; or &ldquo;no.&rdquo; A key missing for a college isn&apos;t shown as
        &ldquo;no&rdquo;: nothing was found for it.
      </p>
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[480px] text-sm sm:min-w-[560px]">
          <thead className="border-b bg-surface-2">
            <tr>
              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-3 text-left text-xs font-semibold text-muted-foreground sm:px-4">Policy</th>
              {schools.map((s, i) => (
                <th key={s.unit_id} className="px-4 py-3 text-left text-xs font-bold">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                    {shortName(s)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y tabular-nums">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className={LABEL_CELL}>{row.label}</td>
                {row.cells.map((item, i) => (
                  <td key={schools[i].unit_id} className="px-4 py-2.5 font-normal">
                    {item ? (
                      item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-primary">
                          {item.text}
                        </a>
                      ) : (
                        item.text
                      )
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}
