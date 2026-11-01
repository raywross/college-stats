/**
 * The reference editor's pure parts (specs/data-platform/change-sets.md "Admin edits" → "Reference documents";
 * specs/data-platform/storage.md `reference.*`, `base.release_calendar`): the known documents' descriptions, the
 * route for one, unwrapping a `{text}` document for a plain textarea, and the validator each document already has
 * (grepped from `lib/`), falling back to "must be an object or array" for a document with none.
 *
 * No server or browser APIs, so tests/admin-reference.test.mts exercises every rule with no network and no database.
 */
import { validateAidPolicies, type AidPolicyFile } from "../aid-policies.ts";
import { validateStateLaws, type StateLawTable } from "../lgbtq.ts";
import { validateGuaranteed, type GuaranteedFile } from "../chances/guaranteed.ts";
import { validateMajorAdmission, type MajorAdmissionFile } from "../chances/major-admission.ts";
import { validateCycleFile } from "../planner/cycle.ts";
import { validateCommonAppTrends, type CommonAppTrendsFile } from "../common-app/trends.ts";
import { organizationsProblems } from "../organizations.ts";
import { aliasTableProblems, buildAliasRow, type AliasRow } from "../aliases.ts";
import { missingSections, parseGuidance } from "../essays/guidance.ts";

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

export interface ReferenceDocumentRow {
  name: string;
  collection: string;
  key: string;
  version: number;
  updated_at: string;
  change_set_id: number;
}

/** A short description for the console's list; a name this table doesn't know shows its collection instead. */
export const REFERENCE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "aid-policies": "Each college's financial-aid policy thresholds and flags.",
  "aliases-curated": "Hand-picked nicknames and abbreviations (AAMU, Bama, Georgia Tech).",
  "application-cycle": "The dates every applicant's planner follows through a cycle.",
  "guaranteed-admission": "Guaranteed-admission programs, by state and GPA or class rank.",
  "major-admission": "Direct-admit and by-major admission rates and review gates.",
  "state-laws": "State laws restricting what a public college may ask or consider.",
  organizations: "Scholarship and access organizations: names, colors, logos.",
  "common-app-trends": "Common App's published season-over-season application trends.",
  "excluded-campuses": "Campuses excluded from the trends pages, and why.",
  "essay-guidance/guidance": "The essay reviewer's guidance text, by craft and approach section.",
  "zcta-centroids": "ZIP Code Tabulation Area centroids, used for distance.",
  calendar: "The IPEDS and Scorecard release calendar the planner and admin watch for.",
};

/** The one line the list shows for a document; an unknown name falls back to naming its collection. */
export function referenceDescription(name: string, collection: string): string {
  return REFERENCE_DESCRIPTIONS[name] ?? `A ${collection} document.`;
}

/** `/admin/data/reference/[name]`: a name with a "/" (the essay guidance text) is percent-encoded into one segment. */
export function referenceHref(name: string): string {
  return `/admin/data/reference/${encodeURIComponent(name)}`;
}

/** Where a name lives: every curated document in `reference.files`, keyed by its name, except the release calendar. */
export function referenceDocumentKey(name: string): { collection: string; key: string } {
  return name === "calendar" ? { collection: "base.release_calendar", key: "calendar" } : { collection: "reference.files", key: name };
}

/* ------------------------------------------------------------------ */
/* Text vs. JSON documents                                             */
/* ------------------------------------------------------------------ */

/** A `{text}` document (zcta-centroids' CSV, the essay guidance markdown): exactly one key, `text`, a string. */
export function isTextDocument(body: unknown): body is { text: string } {
  return !!body && typeof body === "object" && !Array.isArray(body) && Object.keys(body as Record<string, unknown>).length === 1 && typeof (body as Record<string, unknown>).text === "string";
}

export type EditorKind = "text" | "json";

/** What the editor's textarea shows: the bare text for a `{text}` document, two-space JSON otherwise. */
export function bodyToEditor(body: unknown): { kind: EditorKind; value: string } {
  if (isTextDocument(body)) return { kind: "text", value: body.text };
  return { kind: "json", value: JSON.stringify(body, null, 2) };
}

export type EditorResult = { ok: true; body: unknown; bodyText: string } | { ok: false; problem: string };

/**
 * The textarea's text back to a document body, and the exact text to send `admin_data_set_reference` (the function
 * stores `p_body` as written, so a JSON document keeps whatever formatting the admin typed). A text document is
 * re-wrapped as `{text}`.
 */
export function editorToBody(kind: EditorKind, input: string): EditorResult {
  if (kind === "text") {
    const body = { text: input };
    return { ok: true, body, bodyText: JSON.stringify(body) };
  }
  let body: unknown;
  try {
    body = JSON.parse(input);
  } catch {
    return { ok: false, problem: "Not valid JSON." };
  }
  if (body === null || typeof body !== "object") return { ok: false, problem: "The document must be a JSON object or array." };
  return { ok: true, body, bodyText: input };
}

/* ------------------------------------------------------------------ */
/* Validation: the document's own validator when one exists            */
/* ------------------------------------------------------------------ */

function toAliasRows(body: unknown): AliasRow[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter((r): r is { unit_id: string; alias: string } => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).unit_id === "string" && typeof (r as Record<string, unknown>).alias === "string")
    .map((r) => buildAliasRow(r.unit_id, r.alias, "curated"));
}

/**
 * The problems with a saved body, empty when it's sound: the document's own validator when `lib/` has one (aid
 * policies, state laws, guaranteed admission, major admission, the application cycle, Common App trends,
 * organizations, the curated aliases, the essay guidance text's sections), else the generic rule every other
 * document follows — an object or array. `knownUnitIds` is the dataset's college ids; omitted, the unit-id checks
 * are skipped rather than refusing a save over it.
 */
export function validateReference(name: string, body: unknown, knownUnitIds?: Set<string>): string[] {
  switch (name) {
    case "aid-policies":
      return validateAidPolicies(body as AidPolicyFile, knownUnitIds);
    case "state-laws":
      return validateStateLaws(body as StateLawTable);
    case "guaranteed-admission":
      return validateGuaranteed(body as GuaranteedFile, new Date(), knownUnitIds);
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
