/**
 * The To do list as the assistant in the owner's browser works it (specs/product/todo-browser-agent.md "Step 2",
 * items 4 and 5; "Logins"): which rows it may take, in what number, and which login rows are open to it because the
 * owner listed the host (`steward.logins`). Pure, shared by the page, the table and tests.
 */
import type { LoginDoc, TodoDoc } from "./types.ts";

/** Rows per batch in the assistant view. */
export const ASSISTANT_BATCH = 30;
/** The attempt route for a row the assistant worked. */
export const ASSISTANT_ROUTE = "assistant";
/** The `by` form value the assistant view sends. */
export const BY_ASSISTANT = "assistant";

/** A host as a login document's key: lowercase, no leading `www.`. */
export function loginKey(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

/** The owner's login for a row's host, or null. */
export function loginFor(row: Pick<TodoDoc, "host">, logins: ReadonlyMap<string, LoginDoc>): LoginDoc | null {
  if (!row.host) return null;
  return logins.get(loginKey(row.host)) ?? null;
}

/** Whether a row is the assistant's to work: open, not a terms row, and behind a login only where the owner listed the host. */
export function assistantCanWork(row: TodoDoc, logins: ReadonlyMap<string, LoginDoc>): boolean {
  if (row.status !== "open") return false;
  if (row.why === "terms") return false;
  if (row.why === "login") return loginFor(row, logins) !== null;
  return true;
}

/** The rows of one batch, in the list's order: what the assistant may work, up to `limit`. */
export function assistantRows(rows: readonly TodoDoc[], logins: ReadonlyMap<string, LoginDoc>, limit = ASSISTANT_BATCH): TodoDoc[] {
  return rows.filter((r) => assistantCanWork(r, logins)).slice(0, limit);
}

/** A login document from a form's fields; null when the host isn't one. */
export function loginFromFields(f: { host: string; account: string; may_use: boolean; note: string | null; at: string; by: string | null }): LoginDoc | null {
  const host = loginKey(f.host);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return { host, account: f.account.trim().slice(0, 200), may_use: f.may_use, note: f.note, added: f.at, added_by: f.by };
}
