import "server-only";
/**
 * What /admin/health and its CSV share: the health overview joined to the dataset's college facts (name, state, admit
 * rate, the site's selectivity tier), and the filtered, sorted list of rows for a URL's filters. One definition, so the
 * page and the CSV can never disagree about which colleges a filter keeps. Server only.
 */
import { getData } from "@/lib/data";
import { selectivityTier } from "@/lib/metrics";
import { familyListUnits, healthOverview, type HealthOverview } from "@/lib/admin/health";
import { buildHealthRows, filterHealthRows, sortHealthRows, type HealthFilters, type HealthRowView } from "@/lib/admin/health-view";

export interface HealthView {
  overview: HealthOverview;
  /** Every college, joined to the dataset (unfiltered, worst first). */
  all: HealthRowView[];
  /** The colleges on any family's list, or null when that could not be read (the filter is then hidden and ignored). */
  family: ReadonlySet<string> | null;
}

/** The overview and the joined rows. Reads the family lists (a database read) every time: they change as families work. */
export async function loadHealthView(): Promise<HealthView> {
  const [overview, data, family] = await Promise.all([healthOverview(), getData(), familyListUnits()]);
  const all = buildHealthRows(overview.colleges, (unit) => {
    const school = data.getSchoolById(unit);
    if (!school) return null;
    const admitRate = school.admissions.acceptance_rate ?? null;
    return { name: school.name, state: school.location.state, admitRate, tier: selectivityTier(admitRate) };
  });
  return { overview, all: sortHealthRows(all, "worst"), family };
}

/** The rows a URL's filters keep, in its sort order. */
export function selectHealthRows(view: HealthView, filters: HealthFilters): HealthRowView[] {
  return sortHealthRows(filterHealthRows(view.all, filters, view.family), filters.sort);
}
