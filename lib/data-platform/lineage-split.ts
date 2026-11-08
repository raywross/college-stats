/**
 * Each college's citation records (`School.lineage`) at rest, apart from the rest of the college
 * (specs/data-platform/publish.md "Objects in a snapshot", "The loader"; specs/serving-architecture.md "6. Cold
 * starts"). The publisher renders `colleges.json.gz` without any `lineage` key and `lineage.json.gz` as
 * `{ "<unit_id>": <that college's lineage>, … }`; `fetch-snapshot` also explodes it into `lineage/<unit_id>.json`, one
 * file per college. The loader gives every college a lazy `lineage` property that reads its own file on first access,
 * so a cold start parses half the bytes and a reader of `school.lineage` (more than sixty, all synchronous) changes
 * nothing.
 *
 * Pure: no Node or Next imports. The callers do the reading, the loader with its folder spelled literally (so Next's
 * file tracer and tests/tracing.test.mts see it), the scripts with whatever folder they were given.
 */
import type { School } from "../types.ts";

/** One college's lineage records, as `School.lineage` holds them. */
export type SchoolLineage = NonNullable<School["lineage"]>;

/** `lineage.json`: every college that has lineage records, keyed by unit id (written in the colleges' order). */
export type LineageObject = Record<string, SchoolLineage>;

/** Where one college's records live in the bundled copy, relative to the snapshot folder. */
export const lineageFile = (unitId: string) => `lineage/${unitId}.json`;

/** The colleges without their `lineage` keys (every other key in its order) and the records keyed by unit id. */
export function splitLineage(schools: readonly School[]): { colleges: School[]; lineage: LineageObject } {
  const lineage: LineageObject = {};
  const colleges = schools.map((school) => {
    if (!Object.prototype.hasOwnProperty.call(school, "lineage")) return school;
    const { lineage: records, ...rest } = school;
    if (records !== undefined) lineage[school.unit_id] = records;
    return rest as School;
  });
  return { colleges, lineage };
}

/** `lineage.json`'s text: one college per line, like `colleges.json`, so a diff shows the colleges whose records moved. */
export function formatLineageObject(lineage: LineageObject): string {
  const lines = Object.entries(lineage).map(([unit, records]) => `${JSON.stringify(unit)}:${JSON.stringify(records)}`);
  return lines.length ? `{\n${lines.join(",\n")}\n}\n` : "{}\n";
}

/** One college's `lineage/<unit_id>.json`. */
export const formatSchoolLineage = (records: SchoolLineage): string => `${JSON.stringify(records)}\n`;

/**
 * Puts each college's records back as a plain property (the storage source's swap, the publisher's previous
 * snapshot): every college without its own `lineage` key that `lineage` names. A college that still carries its
 * records inline (an older snapshot) is left alone.
 */
export function attachLineage(schools: School[], lineage: LineageObject): void {
  for (const school of schools) {
    if (Object.prototype.hasOwnProperty.call(school, "lineage")) continue;
    const records = lineage[school.unit_id];
    if (records !== undefined) school.lineage = records;
  }
}

/** Where the lazy accessors read from. */
export interface LineageSource {
  /**
   * The unit ids that have records, when the source knows them up front (the exploded folder's file names): only those
   * colleges get the accessor, so the others have no `lineage` key at all, as before. Null: unknown (one whole
   * `lineage.json`), and every college gets one, which removes itself when there are no records.
   */
  units: ReadonlySet<string> | null;
  /** One college's records, or undefined when it has none. Called at most once per college. */
  read(unitId: string): SchoolLineage | undefined;
}

/**
 * The keys a composed college holds after `lineage` (lib/identity.ts places `lineage` before the last two, `trends` and
 * `reported`). The lazy accessor goes back in that place, so a loaded college's keys are in the order the publisher
 * composed them (tests compare `JSON.stringify` of a college with a fresh merge's).
 */
export const KEYS_AFTER_LINEAGE: readonly string[] = ["trends", "reported"];

/**
 * Gives every college without its own `lineage` key (an older snapshot still has them inline: those are left alone) a
 * lazy `lineage` property: the first read calls `source.read`, replaces the accessor with a plain data property
 * holding the result (or removes the key when there is none), and returns it; an assignment replaces the accessor with
 * a plain property too (lib/identity.ts and the compose path assign `lineage`). Enumerable and configurable, so
 * `{ ...school }`, `Object.keys` and `JSON.stringify` see `lineage` as they see a plain property (and load it), in
 * its composed place, before KEYS_AFTER_LINEAGE. A college holding one of those keys is rebuilt in that order and
 * replaced in `schools` (call it before anything else holds the objects, as the loaders do, right after the parse).
 * Returns how many accessors it installed.
 */
export function installLazyLineage(schools: School[], source: LineageSource): number {
  let installed = 0;
  for (let i = 0; i < schools.length; i++) {
    const parsed = schools[i];
    if (Object.prototype.hasOwnProperty.call(parsed, "lineage")) continue;
    if (source.units && !source.units.has(parsed.unit_id)) continue;
    const tail = KEYS_AFTER_LINEAGE.filter((k) => Object.prototype.hasOwnProperty.call(parsed, k));
    let target = parsed;
    if (tail.length) {
      const rebuilt: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) if (!tail.includes(k)) rebuilt[k] = v;
      target = rebuilt as unknown as School;
    }
    const school = target;
    const settle = (value: SchoolLineage | undefined, assigned: boolean) => {
      if (value === undefined && !assigned) delete (school as { lineage?: SchoolLineage }).lineage;
      else Object.defineProperty(school, "lineage", { value, writable: true, enumerable: true, configurable: true });
    };
    Object.defineProperty(school, "lineage", {
      enumerable: true,
      configurable: true,
      get() {
        const value = source.read(school.unit_id);
        settle(value, false);
        return value;
      },
      set(value: SchoolLineage | undefined) {
        settle(value, true);
      },
    });
    if (tail.length) {
      for (const k of tail) (school as unknown as Record<string, unknown>)[k] = (parsed as unknown as Record<string, unknown>)[k];
      schools[i] = school;
    }
    installed++;
  }
  return installed;
}
