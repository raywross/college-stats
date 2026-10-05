import { getSchoolChanges, type Dataset } from "@/lib/data";
import { describeChange, recentPublishes } from "@/lib/changes";
import { dateLabel } from "@/lib/releases";
import type { FieldPath } from "@/lib/fields";
import type { School } from "@/lib/types";
import { Panel } from "@/components/profile/Panel";
import { SourceTip } from "@/components/ui/info-tip";

/**
 * The profile overview's public "What changed" panel (specs/product/follow-colleges.md#in-the-app): this college's
 * changes from the last two publishes that touched it, read from `dataset_changes` (lib/data.ts getSchoolChanges),
 * each one sentence with both years, under its publish date and release. Renders nothing when the college hasn't
 * changed in a year, and always with DATA_SOURCE=json (changes are recorded by publishes, which only Supabase has).
 *
 * Not to be confused with components/history/WhatsChanged.tsx, Home's national trend facts.
 */
export async function ProfileChanges({ school, data }: { school: School; data: Pick<Dataset, "citeField"> }) {
  const groups = recentPublishes(await getSchoolChanges(school.unit_id), new Date());
  if (!groups.length) return null;
  const fields = [...new Set(groups.flatMap((g) => g.changes.map((c) => c.field)))] as FieldPath[];
  const newest = groups[0].publish_id;

  return (
    <Panel id="what-changed" eyebrow="Updates" title="What changed" takeaway="New and revised figures from the latest data releases, each with its year." school={school} fields={fields}>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.publish_id} className="rounded-3xl border bg-card p-4 sm:p-5">
            <p className="text-xs font-semibold text-muted-foreground">
              Published {dateLabel(g.published_at.slice(0, 10))}
              {g.releases.length > 0 && <> · {g.releases.join(", ")}</>}
            </p>
            <ul className="mt-2 space-y-2">
              {g.changes.map((c) => (
                <li key={`${c.field}`} className="flex min-w-0 items-start gap-1.5 text-sm">
                  <span className="min-w-0 break-words">
                    {describeChange(c)}
                    {c.source && <span className="block text-xs text-muted-foreground">{c.source}</span>}
                  </span>
                  {/* The value shown on the profile today: its full citation. Older publishes' values cite the line above. */}
                  {g.publish_id === newest && c.kind !== "disappeared" && <SourceTip cited={data.citeField(c.field, school)} className="mt-0.5 shrink-0" />}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
