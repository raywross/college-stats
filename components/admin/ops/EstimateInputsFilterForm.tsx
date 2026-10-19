import Link from "next/link";
import { CORE_INPUT_KEYS, INPUT_LABELS } from "@/lib/admin/estimate-inputs";
import { STATUS_LABELS } from "@/lib/admin/health-rules";
import { INPUT_SORTS, INPUT_SORT_LABELS, type InputFilters } from "@/lib/admin/inputs-view";
import { selectivityTier } from "@/lib/metrics";

const selectCls = "mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** The site's own tier labels, most selective first (as on the Files view's form). */
const TIERS = ([0.05, 0.15, 0.4, 0.7, null] as const).map((rate) => selectivityTier(rate));

/** The Estimate inputs table's filters as a plain GET form, so every view is a URL. */
export function EstimateInputsFilterForm({ filters, states, familyAvailable, csvHref }: { filters: InputFilters; states: string[]; familyAvailable: boolean; csvHref: string }) {
  return (
    <form method="get" action="/admin/health" className="rounded-2xl border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <label className="block text-sm font-semibold">
          Status
          <select name="status" defaultValue={filters.status ?? ""} className={selectCls}>
            <option value="">Any</option>
            {(["stale", "watch", "fresh"] as const).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Input
          <select name="input" defaultValue={filters.input ?? ""} className={selectCls}>
            <option value="">Any (judges overall)</option>
            {CORE_INPUT_KEYS.map((k) => (
              <option key={k} value={k}>
                {INPUT_LABELS[k]}
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
            {INPUT_SORTS.map((s) => (
              <option key={s} value={s}>
                {INPUT_SORT_LABELS[s]}
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
