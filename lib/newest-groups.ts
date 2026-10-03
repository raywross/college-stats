/**
 * The newest groups (specs/data-expansion/cds-student-body-and-outcomes.md, "The newest groups"): the newest-everywhere
 * rule of round 2 (Decision 1) for everything but the admissions funnel, as one small table. A group is a set of federal
 * paths a college's Common Data Set describes with the same definition one fall or one cohort newer: enrollment (B1),
 * race (B2 column 2), retention (B22), and graduation by Pell group (B4–B11). Admissions keeps its own code
 * (lib/newest.ts#applyNewest: partial replacement, the derived rate, yield).
 *
 * `applyNewestGroups` writes a group's newer values into the federal paths themselves, all or none, with a lineage
 * record per value and the federal values kept in the group's container (`demographics.federal`,
 * `outcomes.federal.retention`, `outcomes.federal.graduation`). `restoreNewestGroups` undoes it byte for byte, and
 * `lib/newest.ts#restoreFederal` calls it, so every "federal baseline" in the pipeline is the same function.
 * `validateNewestGroups` is the lineage guard (rules 1–8; rule 9 lives in `lineageForPatch`).
 *
 * Pure: imports only the field registry (itself pure), never mutates its input. Later CDS specs (C8 test policy, G1 next year's price) add rows.
 */
import { FIELDS, type FieldPath, type VintageKey } from "./fields.ts";
import type { DatasetMeta, FederalDemographics, FederalOutcomes, LineageRecord, ReportedOutcomes, School } from "./types";

export type NewestGroupKey = "enrollment" | "race" | "retention" | "graduation";

export interface NewestGroup {
  key: NewestGroupKey;
  /** The CDS item (or sub-item) that supplies it. */
  item: string;
  /** The federal paths it replaces, together or not at all. */
  targets: readonly FieldPath[];
  /** For a group whose other targets are derived from one path (the graduation rates from the cohorts): that path. */
  anchor?: FieldPath;
  /** Where the replaced federal values are kept. */
  keep: FieldPath;
  /** The release whose year the CDS year must be newer than. */
  federalYear: VintageKey;
  atomic: true;
}

export const NEWEST_GROUPS: readonly NewestGroup[] = [
  { key: "enrollment", item: "B1", targets: ["demographics.undergrad_enrollment", "demographics.men_share", "demographics.women_share", "demographics.part_time_share"], keep: "demographics.federal", federalYear: "scorecard-enrollment", atomic: true },
  { key: "race", item: "B2.degree_seeking", targets: ["demographics.racial_diversity"], keep: "demographics.federal", federalYear: "scorecard-enrollment", atomic: true },
  { key: "retention", item: "B22", targets: ["outcomes.retention_rate"], keep: "outcomes.federal.retention", federalYear: "scorecard-retention", atomic: true },
  {
    key: "graduation",
    item: "B4-B11",
    targets: ["outcomes.grad_cohorts", "outcomes.grad_rate_pell", "outcomes.grad_rate_loan_no_pell", "outcomes.grad_rate_no_pell_no_loan", "outcomes.grad_rate_ftft"],
    anchor: "outcomes.grad_cohorts",
    keep: "outcomes.federal.graduation",
    federalYear: "ipeds-gr",
    atomic: true,
  },
];

/** Every path a newest group owns: an override may not set one (`lineageForPatch`, rule 9). */
export const NEWEST_TARGETS: ReadonlySet<string> = new Set(NEWEST_GROUPS.flatMap((g) => g.targets));

/** One group's newest passed values from a college's CDS records (built by lib/cds/student-body.ts). */
export interface FoundGroup {
  key: NewestGroupKey;
  /** The year compared with the federal one: the fall (enrollment, race) or the entering fall (retention, graduation). */
  year: number;
  /** Target path → value (every target of the group). */
  values: Partial<Record<FieldPath, unknown>>;
  /** Target path → lineage record: every target, or only the anchor. */
  lineage: Partial<Record<FieldPath, LineageRecord>>;
}

/** Everything a college's records offer the newest groups. */
export interface FoundValues {
  groups: Partial<Record<NewestGroupKey, FoundGroup>>;
  /** The 4- and 5-year shares, stored only beside six-year rates of the same class. */
  graduation?: { value: NonNullable<ReportedOutcomes["graduation"]>; lineage: LineageRecord };
}

export type FederalYears = Record<NewestGroupKey, number | null>;

/** The first four-digit year in a label: "Fall 2024" → 2024, "Entered fall 2018" → 2018; null for none. */
export function labelYear(label: string | null | undefined): number | null {
  const m = label?.match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

/** The federal year each group compares against, from `meta.vintages` (never hard-coded). */
export function federalYears(meta: Pick<DatasetMeta, "vintages">): FederalYears {
  const y = (k: VintageKey) => labelYear(meta.vintages[k] ?? null);
  return { enrollment: y("scorecard-enrollment"), race: y("scorecard-enrollment"), retention: y("scorecard-retention"), graduation: y("ipeds-gr") };
}

/** How a group's year reads in the ⓘ ("Fall 2024", "Entered fall 2018"). */
export function groupYearLabel(key: NewestGroupKey, year: number | null): string | null {
  if (year === null) return null;
  return key === "enrollment" || key === "race" ? `Fall ${year}` : `Entered fall ${year}`;
}

function valueAt(school: School, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), school);
}

/** "demographics.men_share" → ["demographics", "men_share"]. Every target is one level under its block. */
const split = (path: FieldPath) => path.split(".") as [string, string];

/**
 * The school with every group whose CDS value is newer than federal data replaced (see the file comment). A group
 * replaces only when its year is newer than the federal year (a tie goes to federal), every target exists on the
 * school, and none of its targets has a lineage record (a value from anywhere but its default federal source is left
 * alone, so restoring always puts back exactly what was there). Returns the same object when nothing is replaced, or
 * when the school already has a container (restore first, as `mergeReported` does).
 */
export function applyNewestGroups(school: School, found: FoundValues | null | undefined, years: FederalYears): School {
  if (!found || !school.demographics || school.demographics.federal || school.outcomes?.federal) return school;
  const lineage = school.lineage ?? {};
  const replaced: NewestGroupKey[] = [];
  for (const g of NEWEST_GROUPS) {
    const f = found.groups[g.key];
    const fy = years[g.key];
    if (!f || fy === null || f.year <= fy) continue;
    const ok = g.targets.every((t) => {
      const [block, key] = split(t);
      const obj = school[block as keyof School] as Record<string, unknown> | undefined;
      return !!obj && key in obj && t in f.values && !lineage[t];
    });
    if (ok) replaced.push(g.key);
  }
  const has = (k: NewestGroupKey) => replaced.includes(k);

  // The 4- and 5-year shares sit only beside six-year rates of the same class: the CDS one when graduation is
  // replaced, or the federal one when federal data has caught up to it.
  const shownGradYear = has("graduation") ? found.groups.graduation!.year : years.graduation;
  const extra = found.graduation && found.graduation.value.entering_year === shownGradYear ? found.graduation : null;
  if (!replaced.length && !extra) return school;

  const values: Partial<Record<FieldPath, unknown>> = {};
  const records: Partial<Record<FieldPath, LineageRecord>> = {};
  for (const k of replaced) {
    const f = found.groups[k]!;
    Object.assign(values, f.values);
    for (const [p, r] of Object.entries(f.lineage) as [FieldPath, LineageRecord][]) records[p] = { ...r };
  }
  const swap = (block: Record<string, unknown>, prefix: string, extraKey: string, extraValue: unknown) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(block)) out[k] = `${prefix}.${k}` in values ? values[`${prefix}.${k}` as FieldPath] : v;
    if (extraValue !== undefined) out[extraKey] = extraValue;
    return out;
  };

  const d = school.demographics;
  let demographics = d;
  if (has("enrollment") || has("race")) {
    const federal: FederalDemographics = {
      year: years.enrollment!,
      undergrad_enrollment: d.undergrad_enrollment,
      men_share: d.men_share ?? null,
      women_share: d.women_share ?? null,
      part_time_share: d.part_time_share ?? null,
      racial_diversity: d.racial_diversity,
    };
    demographics = swap(d, "demographics", "federal", federal) as unknown as School["demographics"];
  }

  const o = school.outcomes;
  let outcomes = o;
  if (o && (has("retention") || has("graduation"))) {
    const federal: FederalOutcomes = {};
    if (has("retention")) federal.retention = { entering_year: years.retention, retention_rate: o.retention_rate };
    if (has("graduation")) {
      federal.graduation = {
        entering_year: years.graduation!,
        grad_rate_pell: o.grad_rate_pell ?? null,
        grad_rate_loan_no_pell: o.grad_rate_loan_no_pell ?? null,
        grad_rate_no_pell_no_loan: o.grad_rate_no_pell_no_loan ?? null,
        grad_rate_ftft: o.grad_rate_ftft ?? null,
        grad_cohorts: o.grad_cohorts ?? null,
      };
    }
    outcomes = swap(o, "outcomes", "federal", federal) as unknown as School["outcomes"];
  }

  const newLineage: Partial<Record<FieldPath, LineageRecord>> = { ...lineage, ...records };
  let reported = school.reported;
  if (extra) {
    reported = { ...(school.reported ?? {}), outcomes: { ...(school.reported?.outcomes ?? {}), graduation: extra.value } };
    newLineage["reported.outcomes.graduation"] = { ...extra.lineage };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(school)) {
    out[k] = k === "demographics" ? demographics : k === "outcomes" ? outcomes : k === "lineage" ? newLineage : k === "reported" ? reported : v;
  }
  if (!("lineage" in out) && Object.keys(newLineage).length) out.lineage = newLineage;
  if (!("reported" in out) && reported) out.reported = reported;
  return out as unknown as School;
}

/** Every path `applyNewestGroups` may give a lineage record. */
const GROUP_LINEAGE_PATHS: readonly FieldPath[] = [...NEWEST_GROUPS.flatMap((g) => g.targets), "reported.outcomes.graduation"];

/**
 * Undoes `applyNewestGroups`: the values from the containers, the containers removed, the groups' college-site records
 * and `reported.outcomes` removed, key order kept. Byte-identical to the school before; the same object when there's
 * nothing to undo.
 */
export function restoreNewestGroups(school: School): School {
  const dFed = school.demographics?.federal;
  const oFed = school.outcomes?.federal;
  const rOut = school.reported?.outcomes;
  if (!dFed && !oFed && !rOut) return school;

  let demographics = school.demographics;
  if (dFed) {
    const back: Record<string, unknown> = {
      undergrad_enrollment: dFed.undergrad_enrollment,
      men_share: dFed.men_share,
      women_share: dFed.women_share,
      part_time_share: dFed.part_time_share,
      racial_diversity: dFed.racial_diversity,
    };
    demographics = Object.fromEntries(
      Object.entries(school.demographics)
        .filter(([k]) => k !== "federal")
        .map(([k, v]) => [k, k in back ? back[k] : v])
    ) as School["demographics"];
  }
  let outcomes = school.outcomes;
  if (oFed && school.outcomes) {
    const back: Record<string, unknown> = {};
    if (oFed.retention) back.retention_rate = oFed.retention.retention_rate;
    if (oFed.graduation) {
      const g = oFed.graduation;
      Object.assign(back, { grad_rate_pell: g.grad_rate_pell, grad_rate_loan_no_pell: g.grad_rate_loan_no_pell, grad_rate_no_pell_no_loan: g.grad_rate_no_pell_no_loan, grad_rate_ftft: g.grad_rate_ftft, grad_cohorts: g.grad_cohorts });
    }
    outcomes = Object.fromEntries(
      Object.entries(school.outcomes)
        .filter(([k]) => k !== "federal")
        .map(([k, v]) => [k, k in back ? back[k] : v])
    ) as School["outcomes"];
  }
  const lineage: Partial<Record<FieldPath, LineageRecord>> = { ...(school.lineage ?? {}) };
  for (const p of GROUP_LINEAGE_PATHS) if (lineage[p]?.source === "college-site") delete lineage[p];
  let reported = school.reported;
  if (rOut && reported) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping `outcomes` is the point
    const { outcomes: _o, ...rest } = reported;
    reported = Object.keys(rest).length ? rest : undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(school)) {
    if (k === "lineage" && !Object.keys(lineage).length) continue;
    if (k === "reported" && !reported) continue;
    out[k] = k === "demographics" ? demographics : k === "outcomes" ? outcomes : k === "lineage" ? lineage : k === "reported" ? reported : v;
  }
  return out as unknown as School;
}

/* ------------------------------------------------------------------ */
/* Citations (lib/lineage.ts#lineageFor)                               */
/* ------------------------------------------------------------------ */

const GROUP_OF = new Map<string, NewestGroup>(NEWEST_GROUPS.flatMap((g) => g.targets.map((t) => [t, g] as const)));

/** The container a group keeps its federal values in, with the federal year. */
function container(school: School, g: NewestGroup): { values: Record<string, unknown>; year: number | null } | null {
  if (g.key === "enrollment" || g.key === "race") {
    const f = school.demographics?.federal;
    return f ? { values: f as unknown as Record<string, unknown>, year: f.year } : null;
  }
  if (g.key === "retention") {
    const f = school.outcomes?.federal?.retention;
    return f ? { values: f as unknown as Record<string, unknown>, year: f.entering_year } : null;
  }
  const f = school.outcomes?.federal?.graduation;
  return f ? { values: f as unknown as Record<string, unknown>, year: f.entering_year } : null;
}

/** The record that cites a target to the college: its own, or (graduation rates) the anchor's. */
function collegeRecord(school: School, g: NewestGroup, path: FieldPath): LineageRecord | null {
  const own = school.lineage?.[path];
  if (own?.source === "college-site") return own;
  if (g.anchor && path !== g.anchor && !own) {
    const a = school.lineage?.[g.anchor];
    if (a?.source === "college-site") return a;
  }
  return null;
}

/**
 * For a newest-group path whose shown value is the college's: the document kind ("cds"), the edition, and the federal
 * value it replaced with that value's year ("Fall 2024", "Entered fall 2018"). Empty for any other path.
 */
export function newestGroupCitation(
  path: FieldPath,
  school: School | undefined
): { sourceKind?: "cds"; cdsEdition?: string; replaces?: { value: number | Record<string, number> | null; year: string | null } } {
  const g = GROUP_OF.get(path);
  if (!school) return {};
  if (!g) {
    // A value from a CDS record (its lineage names the edition, e.g. reported.outcomes.graduation): that document.
    const own = school.lineage?.[path];
    if (own) return own.source === "college-site" && own.edition ? { sourceKind: "cds", cdsEdition: own.edition } : {};
    // A value calculated from a replaced group (the diversity index from race): the same document, nothing replaced.
    const def = FIELDS[path] as { derived?: { inputs: readonly string[] } };
    for (const input of def.derived?.inputs ?? []) {
      const ig = GROUP_OF.get(input);
      const r = ig && collegeRecord(school, ig, input as FieldPath);
      if (r) return { sourceKind: "cds", ...(r.edition ? { cdsEdition: r.edition } : {}) };
    }
    return {};
  }
  const rec = collegeRecord(school, g, path);
  if (!rec) return {};
  const c = container(school, g);
  const key = split(path)[1];
  const value = c ? ((c.values[key] ?? null) as number | Record<string, number> | null) : undefined;
  return {
    sourceKind: "cds",
    ...(rec.edition ? { cdsEdition: rec.edition } : {}),
    ...(c && value !== undefined ? { replaces: { value, year: groupYearLabel(g.key, c.year) } } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* The lineage guard (lib/lineage.ts#validateSchool)                   */
/* ------------------------------------------------------------------ */

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Rules 1–8 of the spec's lineage guard, for every group: a college-cited target is extracted or derived and names its
 * document and edition (1), keeps its federal value in the container (2), is newer than it (3), replaces the whole
 * group with one year (4); a changed value is cited (5); no container without a replacement (6); men + women = 1 (7);
 * the 4- and 5-year shares describe the class of the six-year rates beside them (8).
 */
export function validateNewestGroups(school: School, where: string, meta: Pick<DatasetMeta, "vintages">): string[] {
  const errors: string[] = [];
  const replacedGroups = new Set<NewestGroupKey>();
  for (const g of NEWEST_GROUPS) {
    const cited = g.targets.filter((t) => collegeRecord(school, g, t));
    const c = container(school, g);
    for (const t of g.targets) {
      const rec = school.lineage?.[t];
      if (rec?.source !== "college-site") continue;
      if (rec.method !== "extracted" && rec.method !== "derived") errors.push(`${where}: ${t} cites the college's document, so it must be extracted or derived`);
      if (!rec.quote || !rec.url || !rec.retrieved || !rec.year || !rec.edition) errors.push(`${where}: ${t} cites the college's document but lacks quote, url, retrieved, year, or edition`);
    }
    if (cited.length) {
      replacedGroups.add(g.key);
      if (!c) errors.push(`${where}: ${g.key} values cite the college's document, but ${g.keep} doesn't keep the federal values they replaced`);
      if (cited.length !== g.targets.length) {
        errors.push(`${where}: ${g.key} is replaced in part (${cited.join(", ")}); a group is replaced whole or not at all`);
      }
      const years = new Set(cited.map((t) => collegeRecord(school, g, t)!.year));
      if (years.size > 1) errors.push(`${where}: ${g.key} values describe different years (${[...years].join(", ")})`);
      const y = labelYear([...years][0]);
      if (c && (c.year === null || y === null || y <= c.year)) errors.push(`${where}: ${g.key} from the college (${[...years][0]}) isn't newer than the federal year it replaced (${c.year})`);
    }
    if (c) {
      for (const t of g.targets) {
        const key = split(t)[1];
        if (!(key in c.values)) continue;
        if (!same(valueAt(school, t), c.values[key]) && !collegeRecord(school, g, t)) errors.push(`${where}: ${t} differs from ${g.keep}.${key} but isn't cited to the college's document`);
      }
    }
  }
  if (school.demographics?.federal && !replacedGroups.has("enrollment") && !replacedGroups.has("race")) errors.push(`${where}: demographics.federal is kept, but nothing in it was replaced`);
  if (school.outcomes?.federal?.retention && !replacedGroups.has("retention")) errors.push(`${where}: outcomes.federal.retention is kept, but the retention rate wasn't replaced`);
  if (school.outcomes?.federal?.graduation && !replacedGroups.has("graduation")) errors.push(`${where}: outcomes.federal.graduation is kept, but graduation wasn't replaced`);
  if (school.outcomes?.federal && !school.outcomes.federal.retention && !school.outcomes.federal.graduation) errors.push(`${where}: outcomes.federal is empty`);
  if (replacedGroups.has("enrollment")) {
    const m = school.demographics.men_share;
    const w = school.demographics.women_share;
    if (m == null || w == null || Math.abs(m + w - 1) > 0.0002) errors.push(`${where}: men_share + women_share from the college must add to 1 (got ${m} + ${w})`);
  }
  const extra = school.reported?.outcomes?.graduation;
  if (extra) {
    const shown = replacedGroups.has("graduation") ? labelYear(school.lineage?.["outcomes.grad_cohorts"]?.year) : labelYear(meta.vintages["ipeds-gr"] ?? null);
    if (extra.entering_year !== shown) errors.push(`${where}: reported.outcomes.graduation describes the class that entered in ${extra.entering_year}, but the six-year rates beside it describe ${shown}`);
  }
  return errors;
}
