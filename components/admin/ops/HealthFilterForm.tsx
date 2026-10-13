import Link from "next/link";
import { GROUP_LABELS, HEALTH_GROUPS, HEALTH_STATUSES, STATUS_LABELS } from "@/lib/admin/health-rules";
import { selectivityTier } from "@/lib/metrics";
import { HEALTH_SORTS, SORT_LABELS, reasonLabel, type HealthFilters } from "@/lib/admin/health-view";

const selectCls = "mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** The site's own tier labels (lib/metrics.ts selectivityTier), most selective first, by a rate inside each band. */
const TIERS = ([0.05, 0.15, 0.4, 0.7, null] as const).map((rate) => selectivityTier(rate));

/**
 * The Health table's filters as a plain GET form, so every view is a URL (bookmark it, send it, download its CSV). The
 * "On a family's list" box is rendered only when the family lists could be read (`familyAvailable`).
 */
export function HealthFilterForm({
  filters,
  reasons,
  states,
  familyAvailable,
  csvHref,
}: {
  filters: HealthFilters;
  reasons: { code: string; colleges: number }[];
  states: string[];
  familyAvailable: boolean;
  csvHref: string;
}) {
  return (
    <form method="get" action="/admin/health" className="rounded-2xl border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block text-sm font-semibold">
          Status
          <select name="status" defaultValue={filters.status ?? ""} className={selectCls}>
            <option value="">Any</option>
            {HEALTH_STATUSES.slice()
              .reverse()
              .map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            <option value="unjudged">Not judged (with a group)</option>
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Group
          <select name="group" defaultValue={filters.group ?? ""} className={selectCls}>
            <option value="">Any (judges overall)</option>
            {HEALTH_GROUPS.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Failure reason
          <select name="reason" defaultValue={filters.reason ?? ""} className={selectCls}>
            <option value="">Any</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {reasonLabel(r.code)} ({r.colleges.toLocaleString("en-US")})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          State
          <select name="state" defaultValue={filters.state ?? ""} className={selectCls}>
            <option value="">Any</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Tier
          <select name="tier" defaultValue={filters.tier === null ? "" : String(filters.tier)} className={selectCls}>
            <option value="">Any</option>
            {TIERS.map(({ level, label }) => (
              <option key={level} value={level}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Sort
          <select name="sort" defaultValue={filters.sort} className={selectCls}>
            {HEALTH_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {familyAvailable && (
          <label className="flex min-h-10 items-center gap-2.5 text-sm">
            <input type="checkbox" name="family" value="1" defaultChecked={filters.family} className="size-5 accent-primary" />
            On a family&apos;s list
          </label>
        )}
        <button type="submit" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
          Apply
        </button>
        <Link href="/admin/health" className="inline-flex min-h-10 items-center text-sm underline decoration-dotted underline-offset-2">
          Clear
        </Link>
        <a href={csvHref} className="inline-flex min-h-10 items-center text-sm underline decoration-dotted underline-offset-2 sm:ml-auto">
          Download CSV of this view
        </a>
      </div>
    </form>
  );
}
