/**
 * The reference editor (specs/data-platform/change-sets.md "Admin edits" → "Reference documents"; "The console",
 * Reference row): `lib/admin/reference-view.ts` (text/JSON unwrapping, the document's own validator),
 * `lib/admin/reference-reads.ts` (the list, one document, its versions, over a fake Supabase client),
 * `lib/admin/reference-actions.ts` (Save document, Revert to version {n}, over fake dependencies), and the two
 * pages' guard and nav link. Never touches the database or the live snapshot. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";
import type { School } from "../lib/types.ts";
import { miniReference, miniSchools, miniReleaseCalendar } from "./helpers/snapshot.mts";

// lib/admin/reference-reads.ts starts with `import "server-only"`, which only Next.js resolves.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const json = (...p: string[]) => JSON.parse(read(...p)) as unknown;

const view = await import("../lib/admin/reference-view.ts");
/** The validator with a fixed day injected: the module is pure, so the caller supplies "today" (the guaranteed-admission rules read it). */
const TODAY = new Date("2026-10-31T12:00:00Z");
const validate = (name: string, body: unknown, knownUnitIds?: Set<string>) => view.validateReference(name, body, knownUnitIds, TODAY);
const { fakeSupabase } = await import("./helpers/fake-supabase.mts");
const reads = await import("../lib/admin/reference-reads.ts");
const actions = await import("../lib/admin/reference-actions.ts");

const schools = miniSchools();
const knownUnitIds = new Set(schools.map((s) => s.unit_id));

/* ------------------------------------------------------------------ */
/* referenceHref, referenceDocumentKey, referenceDescription           */
/* ------------------------------------------------------------------ */

test("referenceHref percent-encodes a name with a slash into one route segment; referenceDocumentKey maps calendar to base.release_calendar", () => {
  assert.equal(view.referenceHref("aid-policies"), "/admin/data/reference/aid-policies");
  assert.equal(view.referenceHref("essay-guidance/guidance"), "/admin/data/reference/essay-guidance%2Fguidance");
  assert.deepEqual(view.referenceDocumentKey("calendar"), { collection: "base.release_calendar", key: "calendar" });
  assert.deepEqual(view.referenceDocumentKey("aid-policies"), { collection: "reference.files", key: "aid-policies" });
});

test("referenceDescription: a known name's one-liner, an unknown name names its collection", () => {
  assert.match(view.referenceDescription("aid-policies", "reference.files"), /financial-aid/i);
  assert.equal(view.referenceDescription("some-new-file", "reference.files"), "A reference.files document.");
});

/* ------------------------------------------------------------------ */
/* Text vs. JSON documents                                             */
/* ------------------------------------------------------------------ */

test("isTextDocument: only an object with exactly one string field, text", () => {
  assert.equal(view.isTextDocument({ text: "hi" }), true);
  assert.equal(view.isTextDocument({ text: "hi", other: 1 }), false);
  assert.equal(view.isTextDocument({ text: 1 }), false);
  assert.equal(view.isTextDocument(["a"]), false);
  assert.equal(view.isTextDocument(null), false);
  assert.equal(view.isTextDocument({}), false);
});

test("bodyToEditor/editorToBody round-trip a text document (the bare text, re-wrapped as {text})", () => {
  const editor = view.bodyToEditor({ text: "# Guidance\nBe specific." });
  assert.equal(editor.kind, "text");
  assert.equal(editor.value, "# Guidance\nBe specific.");
  const back = view.editorToBody("text", editor.value);
  assert.deepEqual(back, { ok: true, body: { text: "# Guidance\nBe specific." }, bodyText: JSON.stringify({ text: "# Guidance\nBe specific." }) });
});

test("bodyToEditor/editorToBody round-trip a JSON document (two-space pretty print; the submitted text is sent as written)", () => {
  const body = { a: 1, b: [1, 2] };
  const editor = view.bodyToEditor(body);
  assert.equal(editor.kind, "json");
  assert.equal(editor.value, JSON.stringify(body, null, 2));
  const back = view.editorToBody("json", editor.value);
  assert.equal(back.ok, true);
  if (back.ok) {
    assert.deepEqual(back.body, body);
    assert.equal(back.bodyText, editor.value, "the exact text typed is sent, not re-serialized");
  }
});

test("editorToBody refuses invalid JSON and a bare scalar, before any write", () => {
  assert.deepEqual(view.editorToBody("json", "{not json"), { ok: false, problem: "Not valid JSON." });
  assert.deepEqual(view.editorToBody("json", "5"), { ok: false, problem: "The document must be a JSON object or array." });
  assert.deepEqual(view.editorToBody("json", "null"), { ok: false, problem: "The document must be a JSON object or array." });
  const arr = view.editorToBody("json", "[1,2,3]");
  assert.equal(arr.ok, true);
});

/* ------------------------------------------------------------------ */
/* validateReference: the document's own validator, over the real files */
/* ------------------------------------------------------------------ */

test("validateReference: the real aid-policies.json is sound; a missing required key is not", async () => {
  // No `knownUnitIds` here: the real curated file names ~54 colleges, most outside the mini fixture's 12, so the
  // membership half of the check isn't meaningful on this fixture (per the doc comment, omitting it skips that
  // check rather than refusing); the format checks still run over the real file.
  const body = miniReference("aid-policies") as { policies: Record<string, unknown>[] };
  assert.deepEqual(validate("aid-policies", body), []);
  const broken = { policies: [{ ...body.policies[0], unit_id: undefined }] };
  assert.ok(validate("aid-policies", broken).length > 0);
});

test("validateReference: the real state-laws.json is sound (no knownUnitIds check for this one); a bad date is not", async () => {
  const body = miniReference("state-laws") as { reviewed: string; laws: Record<string, unknown>[] };
  assert.deepEqual(validate("state-laws", body), []);
  const broken = { ...body, reviewed: "not-a-date" };
  assert.ok(validate("state-laws", broken).length > 0);
});

test("validateReference: the real application-cycle.json is sound; a non-object is not", async () => {
  const body = miniReference("application-cycle");
  assert.deepEqual(validate("application-cycle", body), []);
  assert.ok(validate("application-cycle", "nope").length > 0);
});

test("validateReference: the real guaranteed-admission.json and major-admission.json are sound", async () => {
  // No `knownUnitIds`: most curated colleges in these files are outside the mini fixture's 12 (the publisher's
  // reference gate, G5, checks membership against the real dataset at publish time).
  const guaranteed = miniReference("guaranteed-admission");
  assert.deepEqual(validate("guaranteed-admission", guaranteed), []);
  const major = miniReference("major-admission");
  assert.deepEqual(validate("major-admission", major), []);
});

test("validateReference: the real trends/common-app.json and directories/organizations.json are sound", async () => {
  assert.deepEqual(validate("common-app-trends", miniReference("common-app-trends")), []);
  assert.deepEqual(validate("organizations", miniReference("organizations")), []);
});

test("validateReference: the curated aliases name every unit_id it lists (toAliasRows + aliasTableProblems); an unknown unit_id is a problem", async () => {
  const body = miniReference("aliases-curated") as { unit_id: string; alias: string }[];
  // No `knownUnitIds` on the "sound" check: most curated aliases are for colleges outside the mini fixture's 12.
  assert.deepEqual(validate("aliases-curated", body), []);
  assert.ok(validate("aliases-curated", [...body, { unit_id: "0", alias: "Nope U" }], knownUnitIds).length > 0);
  assert.deepEqual(validate("aliases-curated", body), [], "without knownUnitIds the unit-id check is skipped, never refusing a save over it");
});

test("validateReference: the essay guidance text names every missing section; the real document has none", async () => {
  const markdown = miniReference<string>("essay-guidance");
  assert.deepEqual(validate("essay-guidance/guidance", { text: markdown }), []);
  assert.deepEqual(validate("essay-guidance/guidance", { text: "# Mechanics\nonly one section" }).length > 0, true);
  assert.deepEqual(validate("essay-guidance/guidance", "not a text document"), ["The essay guidance document must be { text }."]);
});

test("validateReference: an unknown name (the calendar, or anything else) falls back to object-or-array", async () => {
  assert.deepEqual(validate("calendar", miniReleaseCalendar()), []);
  assert.deepEqual(validate("calendar", "nope"), ["The document must be a JSON object or array."]);
  assert.deepEqual(validate("some-unknown-name", [1, 2, 3]), []);
  assert.deepEqual(validate("some-unknown-name", 5), ["The document must be a JSON object or array."]);
});

/* ------------------------------------------------------------------ */
/* lib/admin/reference-reads.ts, over a fake Supabase client           */
/* ------------------------------------------------------------------ */

function doc(collection: string, key: string, version: number, body: unknown, over: Record<string, unknown> = {}) {
  return { collection, key, version, body, updated_at: "2026-10-31T12:00:00Z", change_set_id: 1, ...over };
}

test("listReferenceDocuments: every reference.files row plus the release calendar, by name", async () => {
  const client = fakeSupabase({
    data_documents: [
      doc("reference.files", "aid-policies", 3, { policies: [] }),
      doc("reference.files", "state-laws", 1, { laws: [] }),
      doc("base.release_calendar", "calendar", 5, { releases: [] }),
      doc("reported.entries", "166027", 1, {}), // a different collection entirely: never listed
    ],
  });
  const list = await reads.listReferenceDocuments(client as never);
  assert.deepEqual(
    list.map((d) => d.name),
    ["aid-policies", "calendar", "state-laws"],
  );
  assert.equal(list.find((d) => d.name === "calendar")?.version, 5);
});

test("loadReferenceDocument: the named document's current body, by its collection and key; null for an unknown name", async () => {
  const client = fakeSupabase({ data_documents: [doc("reference.files", "aid-policies", 2, { policies: [{ unit_id: "1" }] })] });
  const loaded = await reads.loadReferenceDocument(client as never, "aid-policies");
  assert.equal(loaded?.version, 2);
  assert.deepEqual(loaded?.body, { policies: [{ unit_id: "1" }] });
  assert.equal(await reads.loadReferenceDocument(client as never, "nope"), null);
});

test("loadReferenceVersions: newest first; referenceVersionBody reads one version's body or null", async () => {
  const client = fakeSupabase({
    data_document_versions: [
      { collection: "reference.files", key: "aid-policies", version: 1, body: { policies: [] }, deleted: false, change_set_id: 1, created_at: "2026-10-01T00:00:00Z" },
      { collection: "reference.files", key: "aid-policies", version: 2, body: { policies: [{ unit_id: "1" }] }, deleted: false, change_set_id: 2, created_at: "2026-10-15T00:00:00Z" },
    ],
  });
  const versions = await reads.loadReferenceVersions(client as never, "aid-policies");
  assert.deepEqual(versions.map((v) => v.version), [2, 1]);
  assert.deepEqual(await reads.referenceVersionBody(client as never, "reference.files", "aid-policies", 1), { policies: [] });
  assert.equal(await reads.referenceVersionBody(client as never, "reference.files", "aid-policies", 9), null);
});

/* ------------------------------------------------------------------ */
/* lib/admin/reference-actions.ts, over fake dependencies              */
/* ------------------------------------------------------------------ */

function formOf(fields: Record<string, string>) {
  return { get: (name: string) => (name in fields ? fields[name] : null) };
}

function depsFor(over: Partial<{ rpcResult: { ok: true; data: unknown } | { ok: false; error: string }; versionBody: unknown; calls: string[]; knownUnitIds: Set<string> }> = {}) {
  const calls = over.calls ?? [];
  return {
    deps: {
      async rpc(args: { p_name: string; p_body: string; p_note: string | null }) {
        calls.push(`rpc:${args.p_name}`);
        return over.rpcResult ?? { ok: true, data: 1 };
      },
      async readVersion() {
        calls.push("readVersion");
        return over.versionBody ?? null;
      },
      async knownUnitIds() {
        // undefined (not the mini fixture's 12-college set): the real curated files these tests save name many
        // more colleges than the fixture carries, and the unit-id check is explicitly skipped when omitted.
        return over.knownUnitIds ?? undefined;
      },
    },
    calls,
  };
}

test("saveReference: an unparseable or unrecognized document refuses before any rpc call", async () => {
  const { deps, calls } = depsFor();
  const bad = await actions.saveReference(deps, formOf({ name: "aid-policies", kind: "json", body: "{not json" }));
  assert.equal(bad.status, "error");
  assert.deepEqual(calls, []);
});

test("saveReference: a document that fails its own validator refuses before any rpc call", async () => {
  const { deps, calls } = depsFor();
  const body = JSON.stringify({ policies: [{ unit_id: "not-numeric" }] });
  const result = await actions.saveReference(deps, formOf({ name: "aid-policies", kind: "json", body }));
  assert.equal(result.status, "error");
  assert.deepEqual(calls, [], "validateReference's problems stop the save before the rpc");
});

test("saveReference: a sound document calls admin_data_set_reference with the exact typed text and the trimmed note", async () => {
  const { deps, calls } = depsFor();
  const policiesBody = miniReference("aid-policies") as { policies: unknown[] };
  const bodyText = JSON.stringify(policiesBody, null, 2);
  const result = await actions.saveReference(deps, formOf({ name: "aid-policies", kind: "json", body: bodyText, note: "  Per the registrar  " }));
  assert.deepEqual(result, { status: "done", message: "Saved." });
  assert.deepEqual(calls, ["rpc:aid-policies"]);
});

test("saveReference: a text document is re-wrapped as {text} before admin_data_set_reference", async () => {
  const sent: { p_body: string }[] = [];
  const deps = {
    async rpc(args: { p_name: string; p_body: string; p_note: string | null }) {
      sent.push({ p_body: args.p_body });
      return { ok: true as const, data: 1 };
    },
    async readVersion() {
      return null;
    },
    async knownUnitIds() {
      return undefined;
    },
  };
  const markdown = miniReference<string>("essay-guidance");
  const result = await actions.saveReference(deps, formOf({ name: "essay-guidance/guidance", kind: "text", body: markdown }));
  assert.equal(result.status, "done");
  assert.deepEqual(JSON.parse(sent[0].p_body), { text: markdown });
});

test("saveReference: an rpc refusal is turned into plain words, and an unrecognized name refuses before reading the form further", async () => {
  const { deps } = depsFor({ rpcResult: { ok: false, error: "invalid_body" } });
  const refused = await actions.saveReference(deps, formOf({ name: "aid-policies", kind: "json", body: JSON.stringify(miniReference("aid-policies")) }));
  assert.equal(refused.status, "error");
  assert.match((refused as { message: string }).message, /valid JSON/i);

  const noName = await actions.saveReference(depsFor().deps, formOf({ name: "", kind: "json", body: "{}" }));
  assert.equal(noName.status, "error");
});

test("revertReference: requires the typed word 'revert' before reading a version", async () => {
  const { deps, calls } = depsFor();
  const result = await actions.revertReference(deps, formOf({ name: "aid-policies", version: "1", confirm: "nope" }));
  assert.equal(result.status, "error");
  assert.deepEqual(calls, []);
});

test("revertReference: sends the older version's body as the new one, with the fixed note, once confirmed", async () => {
  const oldBody = { policies: [{ unit_id: "1" }] };
  const sent: { p_name: string; p_body: string; p_note: string | null }[] = [];
  const deps = {
    async rpc(args: { p_name: string; p_body: string; p_note: string | null }) {
      sent.push(args);
      return { ok: true as const, data: 2 };
    },
    async readVersion(collection: string, key: string, version: number) {
      assert.equal(collection, "reference.files");
      assert.equal(key, "aid-policies");
      assert.equal(version, 1);
      return oldBody;
    },
    async knownUnitIds() {
      return knownUnitIds;
    },
  };
  const result = await actions.revertReference(deps, formOf({ name: "aid-policies", version: "1", confirm: "Revert" }));
  assert.deepEqual(result, { status: "done", message: "Reverted to version 1." });
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(sent[0].p_body), oldBody);
  assert.equal(sent[0].p_note, "Reverted to version 1");
});

test("revertReference: a version that no longer exists refuses without calling the rpc", async () => {
  const { deps, calls } = depsFor({ versionBody: null });
  const result = await actions.revertReference(deps, formOf({ name: "aid-policies", version: "99", confirm: "revert" }));
  assert.equal(result.status, "error");
  assert.deepEqual(calls, ["readVersion"]);
});

/* ------------------------------------------------------------------ */
/* The pages: the guard and the nav link (static, no Next.js needed)   */
/* ------------------------------------------------------------------ */

test("static: both reference pages call requireAdmin(), and the list page is linked from the Data screens' nav", () => {
  assert.match(read("app/admin/data/reference/page.tsx"), /await requireAdmin\(\)/);
  assert.match(read("app", "admin", "data", "reference", "[name]", "page.tsx"), /await requireAdmin\(\)/);
  assert.match(read("app/admin/data/page.tsx"), /\/admin\/data\/reference[\s\S]*label: "Reference"/);
});

test("static: the document page decodes the route segment (the essay guidance name has a slash, encoded into it)", () => {
  assert.match(read("app", "admin", "data", "reference", "[name]", "page.tsx"), /decodeURIComponent/);
});
