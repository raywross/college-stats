/**
 * The publisher's gates beyond lineage (specs/data-platform/publish.md step 3, git-ci-tests.md "Tests that read
 * committed data"): what `npm run check:lineage` and the reference checks used to run over the committed files, run
 * over the composed snapshot and its layers instead, so a problem fails the publish (nothing uploaded) rather than a
 * pull request. Pure.
 *
 *   referenceGate   every reference document with a validator of its own (lib/reference-validators.ts), the same
 *                   dispatch the console's reference editor refuses a save with
 *   cdsRecordsGate  every CDS record's passed values located and quoted, every document in `reported.docs`
 *                   (lib/cds-records.ts validateCdsRecords), when the store holds the docs manifest
 *   overridesGate   every legacy override says where its values came from (lib/lineage.ts validateOverrides)
 */
import { VALIDATED_REFERENCES, validateReference } from "../../../lib/reference-validators.ts";
import { validateCdsRecords } from "../../../lib/cds-records.ts";
import type { CollegeRecord, ManifestEntry } from "../../../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../../../lib/cds-template.ts";
import { validateOverrides } from "../../../lib/lineage.ts";

/**
 * Problems with the snapshot's reference documents, each prefixed `reference <name>:`. `knownUnitIds` is the composed
 * colleges' ids; omitted (a fixture of a few colleges), the college-membership checks are skipped and the rest run.
 * A validated document the store lacks is not a problem here (the app's own imports fail the build instead).
 */
export function referenceGate(reference: ReadonlyMap<string, unknown>, opts: { knownUnitIds?: Set<string>; today: string }): string[] {
  const today = new Date(`${opts.today}T12:00:00Z`);
  const problems: string[] = [];
  for (const name of VALIDATED_REFERENCES) {
    if (!reference.has(name)) continue;
    for (const p of validateReference(name, reference.get(name), opts.knownUnitIds, today)) problems.push(`reference ${name}: ${p}`);
  }
  // Every other document only has to be an object or an array (the generic rule).
  for (const [name, body] of reference) {
    if ((VALIDATED_REFERENCES as readonly string[]).includes(name)) continue;
    for (const p of validateReference(name, body, opts.knownUnitIds, today)) problems.push(`reference ${name}: ${p}`);
  }
  return problems;
}

/** CDS records against the docs manifest (`reported.docs`); null docs (the store has none, a fixture) skips the check. */
export function cdsRecordsGate(records: readonly CollegeRecord[], docs: readonly ManifestEntry[] | null): string[] {
  if (!docs) return [];
  return validateCdsRecords(records, { updated: null, documents: [...docs] }, CDS_TEMPLATE);
}

/** The legacy overrides (`overrides.legacy`, by unit id): each patch's values cite a source. */
export function overridesGate(overrides: Readonly<Record<string, unknown>>): string[] {
  return validateOverrides({ ...overrides });
}
