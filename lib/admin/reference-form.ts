/**
 * The reference editor's form (specs/product/admin-redesign.md "Data": "Reference gets a form per document where a
 * validator exists ... one field per key, with the validator's message beside the field it names; the raw text stays
 * under Edit as text"). A document whose body is a JSON object gets one field per top-level key: a line for a short
 * string, a box for a long one, a number, yes/no for a boolean, and the key's JSON in a smaller box for a list or an
 * object. The form posts each field back; `formToBody()` puts the document together again in its keys' order, and the
 * save path is the one the textarea uses (lib/admin/reference-actions.ts `saveReference`: the validator, then
 * `admin_data_set_reference`).
 *
 * Pure and client-safe: no server or browser APIs and no import of the validators (they pull in the data), so the
 * client editor and the tests share it.
 */

/** The documents that get a form: the ones with a validator the owner edits by hand, and the release calendar. */
export const FORM_REFERENCES = ["aid-policies", "state-laws", "guaranteed-admission", "calendar"] as const;

export type FieldType = "line" | "text" | "number" | "boolean" | "json";

export interface ReferenceField {
  key: string;
  /** The key in words: "free_tuition_under" → "Free tuition under". */
  label: string;
  type: FieldType;
  /** What the field shows: the string, the number, "true"/"false", or two-space JSON. */
  value: string;
}

/** A string longer than this, or with a line break, gets a box instead of a line. */
export const LONG_STRING = 90;

/** The form's field for one value's key, as `name` on the input. */
export const fieldName = (key: string) => `field:${key}`;

/** A key in words: underscores and hyphens to spaces, the first letter capital. */
export function keyLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Whether a document gets the form: it is one of FORM_REFERENCES and its body is a JSON object with at least one key. */
export function hasForm(name: string, body: unknown): boolean {
  return (FORM_REFERENCES as readonly string[]).includes(name) && isPlainObject(body) && Object.keys(body).length > 0;
}

function fieldType(v: unknown): FieldType {
  if (typeof v === "string") return v.length > LONG_STRING || v.includes("\n") ? "text" : "line";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "json";
}

/** One field per top-level key, in the document's order. */
export function referenceFields(body: Record<string, unknown>): ReferenceField[] {
  return Object.entries(body).map(([key, v]) => {
    const type = fieldType(v);
    const value = type === "line" || type === "text" ? (v as string) : type === "number" || type === "boolean" ? String(v) : JSON.stringify(v, null, 2);
    return { key, label: keyLabel(key), type, value };
  });
}

/** The fields' keys and types as the form's hidden `fields` value (the server reads it back with `parseFieldList`). */
export function fieldList(fields: readonly Pick<ReferenceField, "key" | "type">[]): string {
  return JSON.stringify(fields.map((f) => [f.key, f.type]));
}

const TYPES: readonly FieldType[] = ["line", "text", "number", "boolean", "json"];

/** The hidden `fields` value back to keys and types, or null when it isn't one `fieldList` wrote. */
export function parseFieldList(raw: unknown): { key: string; type: FieldType }[] | null {
  if (typeof raw !== "string") return null;
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length === 0 || list.length > 200) return null;
  const out: { key: string; type: FieldType }[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [key, type] = item;
    if (typeof key !== "string" || !key || key.length > 120 || seen.has(key) || !TYPES.includes(type)) return null;
    seen.add(key);
    out.push({ key, type });
  }
  return out;
}

export type FormBodyResult = { ok: true; body: Record<string, unknown>; bodyText: string } | { ok: false; problem: string };

interface FormLike {
  get(name: string): unknown;
}

/**
 * The form's fields back to a document: each key in the list's order, its value read by its type. A number that isn't
 * one, or a list's or object's text that isn't JSON, refuses with the field's name, before any validator runs. The
 * body is sent as two-space JSON, the way the textarea shows it.
 */
export function formToBody(form: FormLike): FormBodyResult {
  const list = parseFieldList(form.get("fields"));
  if (!list) return { ok: false, problem: "That form was incomplete. Reload the page and try again." };
  const body: Record<string, unknown> = {};
  for (const { key, type } of list) {
    const raw = form.get(fieldName(key));
    const text = typeof raw === "string" ? raw : "";
    const label = keyLabel(key);
    switch (type) {
      case "line":
      case "text":
        body[key] = type === "line" ? text.trim() : text;
        break;
      case "number": {
        const n = Number(text.trim());
        if (text.trim() === "" || !Number.isFinite(n)) return { ok: false, problem: `${label}: enter a number.` };
        body[key] = n;
        break;
      }
      case "boolean":
        if (text !== "true" && text !== "false") return { ok: false, problem: `${label}: choose yes or no.` };
        body[key] = text === "true";
        break;
      case "json":
        try {
          body[key] = JSON.parse(text);
        } catch {
          return { ok: false, problem: `${label}: not valid JSON.` };
        }
        break;
    }
  }
  return { ok: true, body, bodyText: JSON.stringify(body, null, 2) };
}

/**
 * The validator's messages by the field they name, and the rest. A message names a field when it quotes the key
 * (`"reviewed" must be …`), starts with it after the document's name (`guaranteed-admission: cycle 2026 must …`), or
 * names an entry of a list (`aid-policies[3] 166027: …`, `state-laws.json AL: …`), which belongs to the document's one
 * list (its only top-level key whose value is a list or an object), or else names a key as a word (`keep laws
 * sorted`). A message that names none of them goes with the rest, shown above the form.
 */
export function problemsByField(problems: readonly string[], fields: readonly Pick<ReferenceField, "key" | "type">[]): { byKey: Record<string, string[]>; rest: string[] } {
  const keys = fields.map((f) => f.key);
  const lists = fields.filter((f) => f.type === "json").map((f) => f.key);
  const byKey: Record<string, string[]> = {};
  const rest: string[] = [];
  const put = (key: string, p: string) => (byKey[key] ??= []).push(p);
  for (const p of problems) {
    const quoted = keys.find((k) => p.includes(`"${k}"`));
    if (quoted) {
      put(quoted, p);
      continue;
    }
    const colon = p.indexOf(": ");
    const where = colon >= 0 ? p.slice(0, colon) : "";
    const what = colon >= 0 ? p.slice(colon + 2) : p;
    const first = /^[A-Za-z_][\w-]*/.exec(what)?.[0];
    // "guaranteed-admission: checked must be …": the document's name, then the key.
    if (where && !/[\s[]/.test(where) && first && keys.includes(first)) {
      put(first, p);
      continue;
    }
    // "aid-policies[3] 166027: …", "state-laws.json AL: …": an entry of the document's list.
    if (where && /[\s[]/.test(where) && lists.length === 1) {
      put(lists[0], p);
      continue;
    }
    // "state-laws.json: keep laws sorted by state code": a key named as a word.
    const named = keys.find((k) => new RegExp(`(^|[^\\w-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`).test(what));
    if (named) {
      put(named, p);
      continue;
    }
    rest.push(p);
  }
  return { byKey, rest };
}
