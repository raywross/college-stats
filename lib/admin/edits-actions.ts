/**
 * What the field editor's buttons do (specs/data-platform/change-sets.md "Admin edits"), over injected dependencies so
 * tests/admin-edits.test.mts runs every path with no database: **Save** (`admin_data_edit`), **Release**
 * (`admin_data_release_edit`, which releases every live edit of the path), and **Revert to this** (the older row's
 * value saved again through `admin_data_edit`, noted "Reverted to the edit of {date}"). The path is checked against the
 * registry (`editProblem`) and the value against its kind before any call, so a refused form never reaches the
 * database. After a success, the college's public pages and its admin pages are revalidated so the edit shows at once.
 * app/admin/colleges/[unit]/edit/actions.ts calls requireAdmin() first and builds the real dependencies.
 */
import { editProblem } from "../data-platform/edits.ts";
import type { AdminActionState } from "./console.ts";
import { dataErrorMessage, type DataRpc } from "./data-actions.ts";
import { EDIT_KINDS, isEditablePath, longDate, parseInput, type EditKind, type EditRecord, type FormLike } from "./edits-view.ts";

export interface EditActionDeps {
  rpc: DataRpc;
  /** One edit row by id, or null (lib/admin/edits-reads.ts `readEdit` with the admin's session). */
  readEdit(id: number): Promise<EditRecord | null>;
  /** Revalidates each path with its layout (`revalidatePath(path, "layout")`): every page under it. */
  revalidate(paths: string[]): void;
  /** Drops this instance's memo of the live edits (lib/data-platform/live-edits.ts `forgetLiveEdits`), before revalidating. */
  forget(): void;
}

/** After a success: the overlay's memo forgotten, then the college's pages revalidated, so they read the fresh edits. */
function showNow(deps: EditActionDeps, unit: string): void {
  deps.forget();
  deps.revalidate(editPaths(unit));
}

/** The pages an edit changes: the public profile with every topic page under it, and the admin college pages. */
export const editPaths = (unit: string) => [`/schools/${unit}`, `/admin/colleges/${unit}`];

/** The note a revert saves with. */
export const revertNote = (createdAt: string) => `Reverted to the edit of ${longDate(createdAt)}`;

const BAD_FORM: AdminActionState = { status: "error", message: "That form was incomplete. Reload the page and try again." };
const NOT_EDITABLE: AdminActionState = { status: "error", message: "That isn't a field the console can edit." };
const NO_EDIT: AdminActionState = { status: "error", message: "That edit doesn't exist any more. Reload the page." };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const unitFrom = (form: FormLike) => {
  const u = str(form.get("unit"));
  return /^\d{6,8}$/.test(u) ? u : null;
};
const editIdFrom = (form: FormLike) => {
  const t = str(form.get("edit"));
  const n = Number(t);
  return /^\d+$/.test(t) && Number.isSafeInteger(n) && n > 0 ? n : null;
};
/** The note: one line, or null. Over 500 characters is refused by the function (`invalid_note`). */
const noteFrom = (form: FormLike) => str(form.get("note")).replace(/\s+/g, " ") || null;

/** Whether a registered path may be edited, in the console's words (null when it may). */
function pathRefusal(unit: string, path: string): AdminActionState | null {
  return editProblem({ unit_id: unit, path }) !== null || !isEditablePath(path) ? NOT_EDITABLE : null;
}

async function editRpc(deps: EditActionDeps, unit: string, path: string, value: unknown, note: string | null): Promise<AdminActionState | null> {
  const r = await deps.rpc("admin_data_edit", { p_unit: unit, p_path: path, p_value: value, p_note: note });
  return r.ok ? null : { status: "error", message: dataErrorMessage(r.error) };
}

/** Save: the form's value, parsed by its kind, as a new live edit of the path. */
export async function saveEdit(deps: EditActionDeps, form: FormLike): Promise<AdminActionState> {
  const unit = unitFrom(form);
  const path = str(form.get("path"));
  const kind = str(form.get("kind")) as EditKind;
  if (!unit || !path || !EDIT_KINDS.includes(kind)) return BAD_FORM;
  const refused = pathRefusal(unit, path);
  if (refused) return refused;
  const parsed = parseInput(kind, form);
  if (!parsed.ok) return { status: "error", message: `${parsed.problem}.` };
  const failed = await editRpc(deps, unit, path, parsed.value, noteFrom(form));
  if (failed) return failed;
  showNow(deps, unit);
  return { status: "done", message: parsed.value === null ? "Cleared. The college's pages show no value now." : "Saved. The college's pages show it now." };
}

/** Release: the live edit (and every other unreleased edit of its path) released, so the pipelines' value shows again. */
export async function releaseEdit(deps: EditActionDeps, form: FormLike): Promise<AdminActionState> {
  const id = editIdFrom(form);
  if (id === null) return BAD_FORM;
  const row = await deps.readEdit(id);
  if (!row) return NO_EDIT;
  const r = await deps.rpc("admin_data_release_edit", { p_edit: id });
  if (!r.ok) return { status: "error", message: dataErrorMessage(r.error) };
  showNow(deps, row.unit_id);
  return { status: "done", message: "Released. The pipelines' value shows again, by the next publish at the latest." };
}

/** Revert to this: an older edit's value saved again as a new edit, with the note "Reverted to the edit of {date}". */
export async function revertToEdit(deps: EditActionDeps, form: FormLike): Promise<AdminActionState> {
  const id = editIdFrom(form);
  if (id === null) return BAD_FORM;
  const row = await deps.readEdit(id);
  if (!row) return NO_EDIT;
  const refused = pathRefusal(row.unit_id, row.path);
  if (refused) return refused;
  const note = revertNote(row.created_at);
  const failed = await editRpc(deps, row.unit_id, row.path, row.value ?? null, note);
  if (failed) return failed;
  showNow(deps, row.unit_id);
  return { status: "done", message: `${note}.` };
}
