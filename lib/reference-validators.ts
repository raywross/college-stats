/**
 * Each reference document's own validator, by its name in `reference.files` (specs/data-platform/storage.md
 * `reference.*`; change-sets.md "Reference documents"). One dispatch for two callers: the console's reference editor
 * refuses a save that fails it (lib/admin/reference-view.ts re-exports it), and the publisher's reference gate
 * (scripts/publish-snapshot.mts) fails a publish when a composed snapshot's document fails it, like lineage.
 *
 * Pure: no server, browser, or Node APIs.
 */
import { validateAidPolicies, type AidPolicyFile } from "./aid-policies.ts";
import { validateStateLaws, type StateLawTable } from "./lgbtq.ts";
import { validateGuaranteed, type GuaranteedFile } from "./chances/guaranteed.ts";
import { validateMajorAdmission, type MajorAdmissionFile } from "./chances/major-admission.ts";
import { validateCycleFile } from "./planner/cycle.ts";
import { validateCommonAppTrends, type CommonAppTrendsFile } from "./common-app/trends.ts";
import { organizationsProblems } from "./organizations.ts";
import { aliasTableProblems, buildAliasRow, type AliasRow } from "./aliases.ts";
import { missingSections, parseGuidance } from "./essays/guidance.ts";

/** A `{text}` document (zcta-centroids' CSV, the essay guidance markdown): exactly one key, `text`, a string. */
export function isTextDocument(body: unknown): body is { text: string } {
  return !!body && typeof body === "object" && !Array.isArray(body) && Object.keys(body as Record<string, unknown>).length === 1 && typeof (body as Record<string, unknown>).text === "string";
}

/** The documents with a validator of their own; every other document only has to be an object or array. */
export const VALIDATED_REFERENCES = [
  "aid-policies",
  "state-laws",
  "guaranteed-admission",
  "major-admission",
  "application-cycle",
  "common-app-trends",
  "organizations",
  "aliases-curated",
  "essay-guidance/guidance",
] as const;

function toAliasRows(body: unknown): AliasRow[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter((r): r is { unit_id: string; alias: string } => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).unit_id === "string" && typeof (r as Record<string, unknown>).alias === "string")
    .map((r) => buildAliasRow(r.unit_id, r.alias, "curated"));
}

/**
 * The problems with a document body, empty when it's sound: the document's own validator when `lib/` has one (aid
 * policies, state laws, guaranteed admission, major admission, the application cycle, Common App trends,
 * organizations, the curated aliases, the essay guidance text's sections), else the generic rule every other
 * document follows — an object or array. `knownUnitIds` is the dataset's college ids; omitted, the unit-id checks
 * are skipped rather than refusing a save over it.
 */
export function validateReference(name: string, body: unknown, knownUnitIds: Set<string> | undefined, today: Date): string[] {
  switch (name) {
    case "aid-policies":
      return validateAidPolicies(body as AidPolicyFile, knownUnitIds);
    case "state-laws":
      return validateStateLaws(body as StateLawTable);
    case "guaranteed-admission":
      return validateGuaranteed(body as GuaranteedFile, today, knownUnitIds);
    case "major-admission":
      return validateMajorAdmission(body as MajorAdmissionFile, knownUnitIds);
    case "application-cycle":
      return validateCycleFile(body);
    case "common-app-trends":
      return validateCommonAppTrends(body as CommonAppTrendsFile);
    case "organizations":
      return organizationsProblems(body);
    case "aliases-curated":
      return knownUnitIds ? aliasTableProblems(toAliasRows(body), knownUnitIds) : [];
    case "essay-guidance/guidance": {
      if (!isTextDocument(body)) return ["The essay guidance document must be { text }."];
      return missingSections(parseGuidance(body.text)).map((h) => `Missing the "${h}" section.`);
    }
    default:
      if (body === null || typeof body !== "object") return ["The document must be a JSON object or array."];
      return [];
  }
}
