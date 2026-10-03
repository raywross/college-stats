/**
 * Newest figures everywhere (specs/college-reported-round-2.md, Decision 1, "What replaces what"): a college's own
 * newer class (`school.reported.admissions`) replaces the federal (or hand-imported CDS) funnel **in the dataset
 * itself**, value by value, with a lineage record per replaced value and the previous funnel kept in
 * `admissions.federal`. Every view then reads `school.admissions` as before; nothing resolves at render time.
 *
 * `applyNewest` is called by `lib/reported-merge.ts#mergeReported` (so by `npm run merge-reported` and
 * `npm run sync-data`); `restoreFederal` undoes it exactly (byte for byte), so a college dropped from
 * data/college-reported.json gets its previous funnel back. Pure: no I/O, never mutates its input.
 */
import { acceptanceRate } from "./derive.ts";
import { applyNewestFactors, restoreFederalFactors } from "./cds/admissions.ts";
import type { FieldPath } from "./fields";
import type { FederalAdmissions, LineageRecord, School } from "./types";

/** The funnel values `applyNewest` may replace, in `school.admissions` key order. */
const COUNTS = ["applicants", "admitted", "enrolled"] as const;
/** Every funnel path whose value or lineage `applyNewest` can change (and `restoreFederal` puts back). */
const FUNNEL = ["year", "applicants", "admitted", "enrolled", "acceptance_rate"] as const;
type FunnelKey = (typeof FUNNEL)[number];

const adm = (k: FunnelKey) => `admissions.${k}` as FieldPath;
const rep = (k: FunnelKey | "entering_term") => `reported.admissions.${k}` as FieldPath;

const sameRecord = (a: LineageRecord | undefined, b: LineageRecord | undefined) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The school with its newest published admissions figures in `admissions.*` (see the file comment). Returns the
 * same object when there's nothing newer to apply: no `reported.admissions`, a reported class that isn't newer than
 * `admissions.year`, or a school already applied (`admissions.federal` present; call `restoreFederal` first to
 * re-apply after the reported block changed, as `mergeReported` does).
 *
 * The previous funnel's provenance is `lineage["admissions.year"]`: none for federal (IPEDS ADM), the override's
 * record for a hand-imported CDS. A value whose own lineage differs from that (e.g. a Scorecard-only rate) is left
 * alone, so `restoreFederal` can always put back exactly what was there.
 */
export function applyNewest(school: School, opts: { factorsYear?: number | null } = {}): School {
  school = applyNewestFactors(school, opts.factorsYear); // the six shared C7 factors (lib/cds/admissions.ts)
  const r = school.reported?.admissions;
  const a = school.admissions;
  if (!r || a.federal) return school;
  if (a.year !== null && r.year <= a.year) return school;

  const oldLineage = school.lineage ?? {};
  const prev = oldLineage["admissions.year"];
  /** A path we may rewrite: its lineage is the previous funnel's own, so restoring puts back exactly that. */
  const replaceable = (k: FunnelKey) => sameRecord(oldLineage[adm(k)], prev);

  const values: Partial<Record<FunnelKey, number | null>> = {};
  const records: Partial<Record<FunnelKey, LineageRecord>> = {};
  const copy = (from: FieldPath): LineageRecord | undefined => {
    const rec = oldLineage[from];
    return rec ? { ...rec } : undefined;
  };

  for (const k of COUNTS) {
    if (r[k] == null || !replaceable(k)) continue;
    values[k] = r[k];
    const rec = copy(rep(k));
    if (rec) records[k] = rec;
  }
  const replacedCounts = COUNTS.filter((k) => k in values);

  let rateReplaced = false;
  if (replaceable("acceptance_rate")) {
    if (r.acceptance_rate != null) {
      values.acceptance_rate = r.acceptance_rate;
      const rec = copy(rep("acceptance_rate"));
      if (rec) records.acceptance_rate = rec;
      rateReplaced = true;
    } else if ("applicants" in values && "admitted" in values && acceptanceRate(values.applicants!, values.admitted!) !== null) {
      values.acceptance_rate = acceptanceRate(values.applicants!, values.admitted!);
      const ap = oldLineage[rep("applicants")];
      const ad = oldLineage[rep("admitted")];
      records.acceptance_rate = {
        source: "college-site",
        method: "derived",
        year: ap?.year ?? r.entering_term,
        ...(ap?.url ? { url: ap.url } : {}),
        ...(ap?.retrieved ? { retrieved: ap.retrieved } : {}),
        quote: `${ap?.quote ?? ""} / ${ad?.quote ?? ""}`,
      };
      rateReplaced = true;
    }
  }

  // Nothing the college published could replace anything: leave the school as it was.
  if (!replacedCounts.length && !rateReplaced) return school;

  // The previous rate, kept, but no longer next to its own counts: say it's calculated from the previous class's.
  if (!rateReplaced && a.acceptance_rate !== null && replaceable("acceptance_rate")) records.acceptance_rate = keptRateRecord(prev, a.year);

  // The class year moves with applicants or admitted (the counts that define a class), never with enrolled alone.
  if ((values.applicants !== undefined || values.admitted !== undefined) && replaceable("year")) {
    values.year = r.year;
    const rec = copy(rep("entering_term"));
    if (rec) records.year = rec;
  }

  const federal: FederalAdmissions = { year: a.year, applicants: a.applicants, admitted: a.admitted, enrolled: a.enrolled, acceptance_rate: a.acceptance_rate };
  const admissions: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    admissions[k] = k in values ? values[k as FunnelKey] : v;
    if (k === "acceptance_rate") admissions.federal = federal;
  }
  if (!("federal" in admissions)) admissions.federal = federal;

  const lineage: Partial<Record<FieldPath, LineageRecord>> = { ...oldLineage };
  for (const k of FUNNEL) if (records[k]) lineage[adm(k)] = records[k];
  if (prev) lineage["admissions.federal"] = { ...prev };

  return { ...school, admissions: admissions as School["admissions"], lineage };
}

/**
 * Undoes `applyNewest`: the funnel values from `admissions.federal`, each rewritten path's lineage put back to the
 * previous funnel's record (`lineage["admissions.federal"]`, a CDS override's) or removed (federal default), and
 * `admissions.federal` itself removed. Byte-identical to the school before `applyNewest`; the same object when
 * there's nothing to undo.
 */
export function restoreFederal(school: School): School {
  school = restoreFederalFactors(school); // undoes applyNewestFactors (lib/cds/admissions.ts)
  const federal = school.admissions.federal;
  if (!federal) return school;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping `federal` is the point
  const { federal: _federal, ...rest } = school.admissions;
  // Same key order as before: only the funnel values change.
  const admissions = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, k in federal ? federal[k as keyof FederalAdmissions] : v])) as School["admissions"];

  const old = school.lineage ?? {};
  const prev = old["admissions.federal"];
  const keptRate = keptRateRecord(prev, federal.year);
  const lineage: Partial<Record<FieldPath, LineageRecord>> = { ...old };
  delete lineage["admissions.federal"];
  for (const k of FUNNEL) {
    const rec = old[adm(k)];
    // Only the records `applyNewest` wrote: a copied college-site one, or the kept rate's explicit `derived` one.
    if (!rec || !(rec.source === "college-site" || (k === "acceptance_rate" && sameRecord(rec, keptRate)))) continue;
    if (prev) lineage[adm(k)] = prev;
    else delete lineage[adm(k)];
  }
  if (Object.keys(lineage).length) return { ...school, admissions, lineage };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- no lineage left: drop the key, as before applyNewest
  const { lineage: _lineage, ...withoutLineage } = school;
  return { ...withoutLineage, admissions };
}

/** The lineage of a previous rate `applyNewest` kept: the previous funnel's source and year, `method: "derived"`. */
function keptRateRecord(prev: LineageRecord | undefined, year: number | null): LineageRecord {
  return { ...(prev ?? {}), source: prev?.source ?? "ipeds-adm", method: "derived", year: prev?.year ?? (year !== null ? `Fall ${year}` : null) };
}
