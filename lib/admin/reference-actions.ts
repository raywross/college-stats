/**
 * What the reference editor's buttons do (specs/data-platform/change-sets.md "Admin edits" → "Reference documents"):
 * **Save document** validates the textarea's body with the document's own validator (lib/admin/reference-view.ts
 * `validateReference`) and refuses before any write when it finds a problem, then calls `admin_data_set_reference`.
 * **Revert to version {n}** re-saves an older version's body through the same function, with the note "Reverted to
 * version {n}". Over injected dependencies, the way lib/admin/data-actions.ts runs with fakes in
 * tests/admin-data.test.mts; app/admin/data/reference/actions.ts calls `requireAdmin()` first and builds the real
 * ones.
 */
import { ADMIN_ERRORS } from "./constants.ts";
import { ADMIN_FAILED, CONFIRM_REVERT, typedMatches, type AdminActionState } from "./console.ts";
import { editorToBody, referenceDocumentKey, validateReference, type EditorKind } from "./reference-view.ts";

/** The word typed to revert a document to an older version (console.ts, so the client editor imports no server code). */
export { CONFIRM_REVERT };

const REFERENCE_ERRORS: Record<string, string> = {
  reference_not_found: "That document doesn't exist. Reload the page.",
  reference_ambiguous: "More than one document matches that name. This needs a developer.",
  invalid_body: "The document must be valid JSON: an object or array.",
  invalid_note: "Keep the note under 500 characters.",
  "version conflict": "Someone saved this document a moment ago. Reload the page and try again.",
};

/** The plain-words message for an `admin_data_set_reference` refusal. */
export function referenceErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? "";
  if (/\badmin only\b/.test(text)) return ADMIN_ERRORS["admin only"];
  const key = Object.keys(REFERENCE_ERRORS).find((k) => text.includes(k));
  return key ? REFERENCE_ERRORS[key] : ADMIN_FAILED;
}

/** One `admin_data_set_reference` call: the result, or the database's raw error text (mapped by `referenceErrorMessage`). */
export interface ReferenceRpc {
  (args: { p_name: string; p_body: string; p_note: string | null }): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

export interface ReferenceActionDeps {
  rpc: ReferenceRpc;
  /** A past version's body, for Revert to version {n}; null when it no longer exists. */
  readVersion(collection: string, key: string, version: number): Promise<unknown | null>;
  /** The dataset's college ids, for the validators that check `unit_id`s; undefined skips that check rather than refusing a save over it. */
  knownUnitIds(): Promise<Set<string> | undefined>;
}

export interface ReferenceFormLike {
  get(name: string): unknown;
}

function str(form: ReferenceFormLike, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

const NAME_RE = /^[a-z0-9][a-z0-9/_-]{0,120}$/;

/** A reference document's name from a form field, or null when it isn't a name the editor would show (lowercase words, digits, "/", "-", "_"). */
export function nameFromForm(form: ReferenceFormLike): string | null {
  const name = str(form, "name").trim();
  return NAME_RE.test(name) ? name : null;
}

const BAD_NAME: AdminActionState = { status: "error", message: "That document wasn't recognized. Reload the page and try again." };

/**
 * Save document: the textarea's text (JSON, or the bare text of a `{text}` document) is parsed, then checked by the
 * document's own validator when `lib/` has one. A problem refuses the save before any call reaches the database.
 */
export async function saveReference(deps: ReferenceActionDeps, form: ReferenceFormLike): Promise<AdminActionState> {
  const name = nameFromForm(form);
  if (!name) return BAD_NAME;
  const kind: EditorKind = str(form, "kind") === "text" ? "text" : "json";
  const parsed = editorToBody(kind, str(form, "body"));
  if (!parsed.ok) return { status: "error", message: parsed.problem };

  const knownUnitIds = await deps.knownUnitIds();
  const problems = validateReference(name, parsed.body, knownUnitIds, new Date());
  if (problems.length > 0) return { status: "error", message: problems.join(" ") };

  const note = str(form, "note").trim().slice(0, 500) || null;
  const r = await deps.rpc({ p_name: name, p_body: parsed.bodyText, p_note: note });
  if (!r.ok) return { status: "error", message: referenceErrorMessage(r.error) };
  return { status: "done", message: "Saved." };
}

/** Revert to version {n}: that version's body, re-saved through `admin_data_set_reference` with a fixed note. */
export async function revertReference(deps: ReferenceActionDeps, form: ReferenceFormLike): Promise<AdminActionState> {
  const name = nameFromForm(form);
  if (!name) return BAD_NAME;
  if (!typedMatches(form.get("confirm"), CONFIRM_REVERT)) return { status: "error", message: `Type "${CONFIRM_REVERT}" to confirm.` };

  const versionRaw = str(form, "version");
  const version = /^\d+$/.test(versionRaw) ? Number(versionRaw) : null;
  if (version === null || version < 1) return { status: "error", message: "That version wasn't recognized. Reload the page and try again." };

  const { collection, key } = referenceDocumentKey(name);
  const body = await deps.readVersion(collection, key, version);
  if (body === null) return { status: "error", message: "That version no longer exists. Reload the page and try again." };

  const r = await deps.rpc({ p_name: name, p_body: JSON.stringify(body, null, 2), p_note: `Reverted to version ${version}` });
  if (!r.ok) return { status: "error", message: referenceErrorMessage(r.error) };
  return { status: "done", message: `Reverted to version ${version}.` };
}
