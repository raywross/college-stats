/**
 * The data health rules (specs/product/admin.md "Health"): every threshold and the current-cycle edition live here and
 * nowhere else, so the owner can tune them in one place and `tests/admin-health.test.mts` pins them.
 *
 * Pure module (no imports beyond pure helpers) so client components can use the types and labels, and Node tests load
 * it directly. The computation is `collegeHealth()` in lib/admin/health.ts.
 */
import { parseEdition } from "../cds-sections.ts";

/** Worst last: the order the overall status takes the maximum of (Failing > Stale > Watch > Fresh). */
export const HEALTH_STATUSES = ["fresh", "watch", "stale", "failing"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** The four judged data groups, in the order the card and the CSV list them. "What changed" is informational. */
export const HEALTH_GROUPS = ["federal", "reported", "identity", "campus"] as const;
export type HealthGroup = (typeof HEALTH_GROUPS)[number];

export const STATUS_LABELS: Readonly<Record<HealthStatus, string>> = { fresh: "Fresh", watch: "Watch", stale: "Stale", failing: "Failing" };

export const GROUP_LABELS: Readonly<Record<HealthGroup, string>> = {
  federal: "Federal data",
  reported: "College-reported",
  identity: "Identity",
  campus: "Campus life",
};

/** Rank for ordering and for "worst of": higher is worse. */
export function statusRank(status: HealthStatus): number {
  return HEALTH_STATUSES.indexOf(status);
}

/**
 * The fall the current cycle's Common Data Set edition describes. Edition YYYY-YY describes the fall of YYYY and is
 * posted through the following year, so in October 2026 the newest a college can have published is the 2025 edition
 * (the next starts to appear around December). **Bump this when the first next-cycle editions are in**; the guard in
 * tests/admin-health.test.mts fails once it is a year behind the calendar. Held as the start year, not the label, so
 * the "no hard-coded data years" guard (tests/citation-guards.test.mts) has nothing to flag.
 */
export const CURRENT_CDS_EDITION_START = 2025;

/** The edition label for a start year: 2025 → "2025-26". */
export function editionLabelFor(start: number): string {
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The current cycle's edition, as the manifest and records spell it ("2025-26"). */
export const CURRENT_CDS_EDITION = editionLabelFor(CURRENT_CDS_EDITION_START);

/** The fall a CDS edition describes ("2025-26" → 2025); null when it isn't an edition. */
export function editionStart(edition: string | null | undefined): number | null {
  return parseEdition(edition)?.start ?? null;
}

export interface HealthRules {
  /** College-reported: how far behind the current cycle's edition the newest CDS may be. */
  reported: {
    /** The edition that counts as current. Fresh needs this one (or newer). */
    currentEdition: string;
    /** One edition behind is Watch. */
    watchEditionsBehind: number;
    /** This many editions behind (or more) is Stale. */
    staleEditionsBehind: number;
    /** A failure at one of these stages is Failing. */
    failingStages: readonly string[];
    /** A failure with this reason code is Failing only when the review queue holds an item for the college. */
    failingWithQueueReason: string;
  };
  /** Identity (links, social, brand): days since the newest probe. */
  identity: { freshDays: number; watchDays: number };
  /** Campus life (directories, campus pages, religion, LGBTQ): days since the newest collection. */
  campus: {
    freshDays: number;
    watchDays: number;
    /** A college with no dated campus record at all ("never collected"). */
    neverCollected: HealthStatus;
  };
}

export const HEALTH_RULES: HealthRules = {
  reported: {
    currentEdition: CURRENT_CDS_EDITION,
    watchEditionsBehind: 1,
    staleEditionsBehind: 2,
    failingStages: ["fetch", "read"],
    failingWithQueueReason: "failed_checks",
  },
  // Probed within the refresh cadence (the identity refresh runs every four weeks): fresh; to 90 days: watch.
  identity: { freshDays: 28, watchDays: 90 },
  campus: { freshDays: 180, watchDays: 365, neverCollected: "stale" },
};

/**
 * The federal core fields (Federal group: all present is Fresh, one or more missing is Watch; the group has no worse
 * status). A field with several paths counts as present when any one is (a college reports SAT or ACT ranges, not
 * both). Paths are registered fields (lib/fields.ts); the test checks that.
 */
export const CORE_FEDERAL_FIELDS: readonly { key: string; label: string; paths: readonly string[] }[] = [
  { key: "admit_rate", label: "admit rate", paths: ["admissions.acceptance_rate"] },
  { key: "test_ranges", label: "test ranges", paths: ["admissions.sat_math_25_75", "admissions.act_composite_25_75"] },
  { key: "net_price", label: "net price", paths: ["cost.avg_net_price"] },
  { key: "graduation", label: "graduation rate", paths: ["outcomes.graduation_rate"] },
  { key: "earnings", label: "earnings", paths: ["outcomes.median_earnings_10yr"] },
];

/**
 * The Estimate inputs view (specs/product/admin-health-views.md "Status per input"): how many admission cycles behind
 * the current one a core input may be. The current cycle's fall is the CDS edition's, so the two views agree on it.
 */
export interface EstimateInputRules {
  /** The fall of the current cycle: a value describing it (or later) is current. */
  currentFall: number;
  /** This many cycles behind is Watch. */
  watchCyclesBehind: number;
  /** This many cycles behind (or more) is Stale. */
  staleCyclesBehind: number;
}

export const ESTIMATE_INPUT_RULES: EstimateInputRules = {
  currentFall: CURRENT_CDS_EDITION_START,
  watchCyclesBehind: 1,
  staleCyclesBehind: 2,
};

/** Lineage records that date the identity group (links, social, brand). */
export const IDENTITY_LINEAGE_PREFIXES: readonly string[] = ["links.", "social.", "brand."];

/** Lineage records that date the campus-life group (directories, campus pages, religion, LGBTQ). */
export const CAMPUS_LINEAGE_KEYS: readonly string[] = ["directories", "campus.", "religion", "lgbtq."];

/** How many of the newest publishes the overview reads `dataset_changes` from (the newest change per college wins). */
export const CHANGES_PUBLISHES_READ = 8;

/** How long the overview keeps the `dataset_changes` read before asking Supabase again (the files are cached per instance). */
export const CHANGES_TTL_MS = 10 * 60 * 1000;
