/**
 * Document collisions (specs/product/document-collisions.md): the pure comparison over two files shaped like UC Santa
 * Cruz's (tests/fixtures/document-collisions), Keep this file on a file store (refusals, the log first, one change set),
 * the Steward's writer leaving a collision finding instead of a refile, the apply job refusing a colliding refile with
 * the link, the Inbox's rows, and the college page's Documents panel rendered with stand-ins. No database, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import type { CollegeRecord, DocumentRecord, ManifestEntry } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import type { Recipe, ReviewItem } from "../lib/reported.ts";
import type { IssueDoc, ProposalDoc, ProposalRow } from "../lib/steward/types.ts";
import {
  CHOOSE_THE_FILE,
  collisionHref,
  collisionIssueKey,
  collisionNamedIn,
  collisions,
  compareDocuments,
  compareHref,
  compareLinkIn,
  documentFacts,
  factsSentence,
  filedByOf,
  findDocument,
  keepSentence,
  parseCompare,
  refileCollision,
} from "../lib/admin/document-compare.ts";
import { KEEP_COLLECTIONS, KEEP_SOURCE, keepDocument, keepWhy, type KeepDeps } from "../lib/admin/keep-document.ts";
import { needsYou, type InboxInput } from "../lib/admin/inbox.ts";
import { isHelpKey } from "../lib/admin/help.ts";
import { CONFIRM_KEEP } from "../lib/admin/console.ts";
import { dropDocument } from "../scripts/drop-document.mts";
import { setProposalStatus } from "../scripts/lib/steward/proposals.mts";
import { ApplyRefused, applyProposal } from "../scripts/lib/steward/apply.mts";
import { StewardWriter, WriteRefused } from "../scripts/lib/steward/writer.mts";
import { SYSTEM_PROMPT } from "../scripts/lib/steward/prompts.mts";
import { COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import { fileStore, fileStoreChangeSets, type DataStore } from "../scripts/lib/data-platform/store.mts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "document-collisions", "ucsc-record.json"), "utf8")) as { record: CollegeRecord; manifest: ManifestEntry[] };
const UNIT = "110714";
const [DRIVE_DOC, OFFICIAL_DOC] = FIXTURE.record.documents;
const DRIVE = DRIVE_DOC.sha256;
const OFFICIAL = OFFICIAL_DOC.sha256;
const MANIFEST = new Map(FIXTURE.manifest.map((m) => [m.sha256, m]));
const record = (): CollegeRecord => structuredClone(FIXTURE.record);
/** The record with both files filed 2024-25: a collision on the record itself. */
const colliding = (): CollegeRecord => ({ unit_id: UNIT, documents: [{ ...structuredClone(DRIVE_DOC), edition: "2024-25" }, structuredClone(OFFICIAL_DOC)] });

/* ------------------------------------------------------------------ */
/* The pure comparison                                                 */
/* ------------------------------------------------------------------ */

test("documentFacts: when and where each file was pulled, how its edition was decided, who read it, and its counts", () => {
  const drive = documentFacts(DRIVE_DOC, MANIFEST.get(DRIVE), CDS_TEMPLATE);
  assert.deepEqual(drive.source, { url: "https://drive.google.com/file/d/1UCSCcds/view", host: "drive.google.com", finalUrl: "https://drive.usercontent.google.com/download?id=1UCSCcds" });
  assert.equal(drive.retrieved, "2026-10-26");
  assert.equal(drive.filedAs, "2025-26");
  assert.equal(drive.filedBy, "assumed");
  assert.equal(drive.coverLine, "states no edition");
  assert.deepEqual(drive.reader, { by: "Sonnet", on: "2026-10-26", mode: "interactive" });
  assert.equal(drive.itemsRead, 8);
  assert.equal(drive.itemsWithFailures, 8);
  assert.equal(drive.itemsTotal, 1105);
  assert.equal(drive.pages, 38);
  assert.equal(drive.bytes, 1203456);
  assert.equal(factsSentence(drive), "Pulled 2026-10-26 from drive.google.com (the full address under Details); filed as 2025–26 by assumption; read by Sonnet on 2026-10-26: 8 of 1,105 items, 8 with check failures.");

  const official = documentFacts(OFFICIAL_DOC, MANIFEST.get(OFFICIAL));
  assert.equal(official.source.host, "www.ucsc.edu");
  assert.equal(official.source.finalUrl, undefined);
  assert.equal(official.filedBy, "stated");
  assert.equal(official.coverLine, undefined);
  assert.deepEqual(official.reader, { by: "Sonnet", on: "2026-10-19", mode: "batch" }, "the newest read");
  assert.equal(official.itemsTotal, null, "no template given");
  assert.equal(official.itemsWithFailures, 1);
  assert.match(factsSentence(official), /^Pulled 2026-10-19 from www\.ucsc\.edu .*filed as 2024–25 as the file states; read by Sonnet on 2026-10-19: 9 items, 1 with check failures\.$/);

  assert.equal(documentFacts(OFFICIAL_DOC).filedBy, "unknown", "no manifest entry");
  assert.deepEqual(["cover", "items", "workbook", "url", "manual", "assumed", "none", undefined].map((f) => filedByOf(f as ManifestEntry["edition_from"])), ["stated", "stated", "stated", "stated", "manual", "assumed", "unknown", "unknown"]);
  const cover = structuredClone(OFFICIAL_DOC);
  cover.items["C.101"].failures = [{ check: "edition-mismatch", detail: "the cover says 2023-2024; the document is filed as 2024-25" }];
  assert.equal(documentFacts(cover).coverLine, "the cover says 2023-2024");
});

test("compareDocuments: agree, differ (sorted by section then code, named, formatted by type), only in one, failures", () => {
  const c = compareDocuments(OFFICIAL_DOC, DRIVE_DOC, CDS_TEMPLATE);
  assert.equal(c.agree, 4);
  assert.deepEqual(c.differ, [
    { code: "C.101", label: c.differ[0].label, a: "30,012", b: "30,120" },
    { code: "C.901", label: c.differ[1].label, a: "5%", b: "6%" },
    { code: "G.101", label: c.differ[2].label, a: "$14,100", b: "$14,523" },
  ]);
  assert.match(c.differ[0].label, /^C\.101, /, "codeLabel names the item");
  assert.deepEqual(c.onlyA.map((r) => [r.code, r.value]), [["B.101", "4,512"], ["C.1001", "95%"]]);
  assert.deepEqual(c.onlyB.map((r) => r.code), ["B.2201"]);
  assert.equal(c.failuresA, 1);
  assert.equal(c.failuresB, 8);
  const plain = compareDocuments(OFFICIAL_DOC, DRIVE_DOC);
  assert.equal(plain.differ[1].a, "0.05", "without the template a share stays a number");
});

test("collisions, findDocument and refileCollision", () => {
  assert.deepEqual(collisions(record()), [], "two editions: no collision on the record");
  const both = collisions(colliding());
  assert.equal(both.length, 1);
  assert.equal(both[0].edition, "2024-25");
  assert.deepEqual(both[0].documents.map((d) => d.sha256), [DRIVE, OFFICIAL], "newest pull first");
  assert.equal(collisions(null).length, 0);

  assert.equal(findDocument(record(), "f38e8289")?.sha256, DRIVE);
  assert.equal(findDocument(record(), "F38E8289EF")?.sha256, DRIVE);
  assert.equal(findDocument(record(), "f38e"), null, "too short");
  assert.equal(findDocument(record(), "nothex!"), null);

  assert.equal(refileCollision(record(), "f38e8289ef", "2024-25"), OFFICIAL, "the incident: the Drive copy into 2024-25");
  assert.equal(refileCollision(record(), "f38e8289ef", "2024-2025"), OFFICIAL, "any spelling of the edition");
  assert.equal(refileCollision(record(), "f38e8289ef", "2023-24"), null, "a free edition");
  assert.equal(refileCollision(record(), "f38e8289ef", "2025-26"), null, "the edition it is already in");
  assert.equal(refileCollision(record(), "abcdef1234", "2024-25"), null, "a file the record doesn't hold");
});

test("the compare link: built, found in a message, parsed from the query; the old refusal named", async () => {
  const href = compareHref(UNIT, DRIVE, OFFICIAL);
  assert.equal(href, "/admin/data/colleges/110714?compare=f38e8289ef,420859b8b6#documents");
  assert.equal(compareLinkIn(`110714 already has a 2024-25 document; choose the file: ${href}`), href);
  assert.equal(compareLinkIn("no link here"), null);
  assert.equal(compareLinkIn(null), null);
  assert.deepEqual(parseCompare("f38e8289ef,420859b8b6"), ["f38e8289ef", "420859b8b6"]);
  assert.deepEqual(parseCompare(["F38E8289EF, 420859b8b6"]), ["f38e8289ef", "420859b8b6"]);
  assert.equal(parseCompare("f38e8289ef"), null);
  assert.equal(parseCompare("f38e8289ef,f38e8289ef"), null);
  assert.equal(parseCompare("x,y"), null);
  assert.equal(parseCompare(undefined), null);
  assert.deepEqual(collisionNamedIn("steward apply refile-x failed: 110714 already has a 2024-25 document"), { unit: UNIT, edition: "2024-25" });
  assert.equal(collisionIssueKey(UNIT, "2024-25"), "collision|110714|2024-25");

  const p = (over: Partial<ProposalDoc>): ProposalDoc => ({ ...proposal(), ...over });
  const read = async () => record();
  assert.equal(await collisionHref(p({ status: "approved" }), read), href, "worked out from the record");
  assert.equal(await collisionHref(p({ status: "failed", failed_reason: `x ${href}` }), async () => null), href, "carried by the reason");
  assert.equal(await collisionHref(p({ status: "applied" }), read), null);
  assert.equal(await collisionHref(p({ status: "approved", rows: [{ ...refileRow(), edition: "2023-24" }] }), read), null);
  assert.equal(await collisionHref(p({ kind: "hold" }), read), null);

  assert.equal(
    keepSentence(documentFacts(OFFICIAL_DOC), 63),
    "The other file (pulled 2026-10-19 from www.ucsc.edu) is dropped from this college: its 63 queue items go, its address is listed so discovery won't fetch it again. The kept file stays as it is.",
  );
  assert.match(keepSentence(documentFacts(OFFICIAL_DOC), 1), /its 1 queue item go/);
});

/* ------------------------------------------------------------------ */
/* A seeded file store                                                 */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-11-08T18:00:00Z");
const queueItem = (sha256: string, edition: string, code: string): ReviewItem => ({ unit_id: UNIT, name: "UC Santa Cruz", urls: [], entering_term: null, failures: [], queued: "2026-10-26", run: "r", code, edition, sha256 });

function refileRow(): ProposalRow {
  return { unit_id: UNIT, field: null, code: null, edition: "2024-25", sha256: "f38e8289ef", now: "Filed 2025-26", proposed: "H.101 and B22 say 2024-25", source: { page: null, line: null, quote: null, url: null }, recommends: "approve", item: null };
}
function proposal(): ProposalDoc {
  return { key: "refile-ucsc", kind: "refile", cause: null, status: "approved", summary: "Refile UC Santa Cruz's Drive copy to 2024-25", evidence: [], rows: [{ ...refileRow(), decision: "approved" }], run: "r1", created: "2026-11-07T10:00:00Z" };
}

async function seeded(rec: CollegeRecord = record()): Promise<{ dir: string; store: DataStore }> {
  const dir = join(mkdtempSync(join(tmpdir(), "collisions-")), "layers");
  const store = fileStore(dir);
  const set = await store.open("import", "test-seed", "seed");
  await set.write(COLLECTIONS.reported.cdsRecords, [{ key: UNIT, body: rec }]);
  await set.write(COLLECTIONS.reported.docs, FIXTURE.manifest.map((m) => ({ key: m.sha256, body: m })));
  await set.write(COLLECTIONS.reported.reviewQueue, [
    ...["C.101", "C.102", "C.116"].map((c) => ({ key: `${UNIT}|2025-26|${c}`, body: queueItem(DRIVE, "2025-26", c) })),
    { key: `${UNIT}|2024-25|C.905`, body: queueItem(OFFICIAL, "2024-25", "C.905") },
  ]);
  const recipe: Recipe = { unit_id: UNIT, sources: [{ kind: "cds", url: DRIVE_DOC.url, format: "pdf", sha256: DRIVE }, { kind: "cds", url: OFFICIAL_DOC.url, format: "pdf", sha256: OFFICIAL }], index_urls: [], learned: "2026-10-01", model: "m" };
  await set.write(COLLECTIONS.reported.sources, [{ key: UNIT, body: recipe }]);
  const other: ProposalDoc = { ...proposal(), key: "refile-other", rows: [{ ...refileRow(), unit_id: "166027", sha256: "abcdef1234" }] };
  await set.write(COLLECTIONS.steward.proposals, [
    { key: "refile-ucsc", body: proposal() },
    { key: "refile-other", body: other },
  ]);
  const issue: IssueDoc = { key: collisionIssueKey(UNIT, "2024-25"), kind: "collision", status: "waiting", hypothesis: "Two files claim 2024-25", findings: [], proposals: [], reason: null, run: "r1", updated: "2026-11-08T10:00:00Z", href: compareHref(UNIT, DRIVE, OFFICIAL), action: CHOOSE_THE_FILE };
  await set.write(COLLECTIONS.steward.issues, [{ key: issue.key, body: issue }]);
  await set.close("applied");
  return { dir, store };
}

/* ------------------------------------------------------------------ */
/* Keep this file                                                      */
/* ------------------------------------------------------------------ */

function form(over: Record<string, string> = {}) {
  const values: Record<string, string> = { unit: UNIT, keep: OFFICIAL, drop: DRIVE, confirm: CONFIRM_KEEP, ...over };
  return { get: (name: string) => values[name] ?? null };
}

function deps(store: DataStore, over: Partial<KeepDeps> = {}) {
  const notes: { action: string; details: Record<string, unknown> }[] = [];
  const revalidated: string[] = [];
  const d: KeepDeps = {
    store,
    drop: dropDocument,
    setStatus: setProposalStatus,
    async note(action, details) {
      notes.push({ action, details });
      return { ok: true };
    },
    admin: "admin-1",
    now: () => NOW,
    revalidate: (unit) => revalidated.push(unit),
    ...over,
  };
  return { d, notes, revalidated };
}

test("keep: the collections agree with the store's", () => {
  assert.equal(KEEP_COLLECTIONS.cdsRecords, COLLECTIONS.reported.cdsRecords);
  assert.equal(KEEP_COLLECTIONS.docs, COLLECTIONS.reported.docs);
  assert.equal(KEEP_COLLECTIONS.proposals, COLLECTIONS.steward.proposals);
  assert.equal(KEEP_COLLECTIONS.issues, COLLECTIONS.steward.issues);
});

test("keep: refusals change nothing and log nothing", async () => {
  const { dir, store } = await seeded();
  const before = fileStoreChangeSets(dir).length;
  const cases: [Record<string, string>, RegExp][] = [
    [{ confirm: "" }, /Type keep/],
    [{ confirm: "drop" }, /Type keep/],
    [{ unit: "11071" }, /wasn't recognized/],
    [{ drop: OFFICIAL }, /two different files/],
    [{ drop: "" }, /two different files/],
    [{ drop: "abcdef1234" }, /no longer on this college's record/],
    [{ unit: "166027" }, /no longer on this college's record/],
  ];
  for (const [over, message] of cases) {
    const { d, notes } = deps(store);
    const r = await keepDocument(d, form(over));
    assert.equal(r.status, "error", JSON.stringify(over));
    assert.match((r as { message: string }).message, message);
    assert.equal(notes.length, 0, "nothing logged");
  }
  const { d } = deps(store, { note: async () => ({ ok: false, message: "the log is down" }) });
  const r = await keepDocument(d, form());
  assert.deepEqual(r, { status: "error", message: "Nothing was changed because it could not be logged: the log is down" });
  assert.equal(fileStoreChangeSets(dir).length, before, "no change set opened");
  assert.equal((await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, UNIT))!.documents.length, 2);
});

test("keep: logs first, then in one keep-document set drops the other file, declines the refile, settles the finding", async () => {
  const { dir, store } = await seeded();
  const { d, notes, revalidated } = deps(store);
  const order: string[] = [];
  const logged = d.note;
  d.note = async (a, x) => (order.push(`note ${a}`), logged(a, x));
  const open = store.open.bind(store);
  d.store = { ...store, open: async (...args: Parameters<DataStore["open"]>) => (order.push("open"), open(...args)) } as DataStore;
  const r = await keepDocument(d, form({ keep: "420859b8b6", drop: "f38e8289ef" }));
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.match((r as { message: string }).message, /^Kept the file pulled 2026-10-19 from www\.ucsc\.edu \(2024–25\)\. The other file is dropped: 3 queue items gone; 1 refile proposal declined; the finding settled\. It reaches the site at the next publish\.$/);
  assert.deepEqual(order, ["note review.keep_file", "open"], "the log row comes before any write");
  assert.equal(notes[0].details.kept, OFFICIAL);
  assert.equal(notes[0].details.dropped, DRIVE);
  assert.deepEqual(revalidated, [UNIT]);

  const rec = (await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, UNIT))!;
  assert.deepEqual(rec.documents.map((x) => x.sha256), [OFFICIAL], "the kept file stays as it is");
  assert.equal(rec.documents[0].edition, "2024-25");
  assert.equal(await store.readOne(COLLECTIONS.reported.docs, DRIVE), null);
  assert.deepEqual([...(await store.read<ReviewItem>(COLLECTIONS.reported.reviewQueue, `${UNIT}|`)).keys()], [`${UNIT}|2024-25|C.905`]);
  const recipe = (await store.readOne<Recipe>(COLLECTIONS.reported.sources, UNIT))!;
  assert.deepEqual(recipe.sources.map((s) => s.sha256), [OFFICIAL]);
  assert.equal(recipe.dropped?.[0].url, DRIVE_DOC.url);
  assert.equal(recipe.dropped?.[0].why, keepWhy(OFFICIAL_DOC, "2026-11-08"));
  assert.equal(recipe.dropped?.[0].why, "Kept 420859b8b6 (www.ucsc.edu, pulled 2026-10-19); the admin chose it over this file on 2026-11-08");

  const p = (await store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, "refile-ucsc"))!;
  assert.equal(p.status, "declined");
  assert.equal(p.decided_by, "admin-1");
  assert.match(p.decision_note ?? "", /kept 420859b8b6 .* dropped f38e8289ef on 2026-11-08; this refile no longer applies/);
  assert.equal((await store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, "refile-other"))!.status, "approved", "another college's refile is left alone");
  const issue = (await store.readOne<IssueDoc>(COLLECTIONS.steward.issues, collisionIssueKey(UNIT, "2024-25")))!;
  assert.equal(issue.status, "left");
  assert.match(issue.reason ?? "", /^Settled: the admin kept 420859b8b6 and dropped f38e8289ef on 2026-11-08\.$/);

  const sets = fileStoreChangeSets(dir).filter((s) => s.source === KEEP_SOURCE);
  assert.equal(sets.length, 1, "one change set");
  assert.equal(sets[0].status, "applied");
  assert.equal(fileStoreChangeSets(dir).filter((s) => s.source === "drop-document" || s.source === "steward-status").length, 0, "the drop and the decline wrote into the keep's set");
});

test("keep: a failure after the drop closes the set held with the reason; one before it closes it applied and empty", async () => {
  {
    const { dir, store } = await seeded();
    const { d, notes } = deps(store, { setStatus: async () => Promise.reject(new Error("the proposal write failed")) });
    const r = await keepDocument(d, form());
    assert.equal(r.status, "error");
    assert.match((r as { message: string }).message, /The file was dropped, but the rest didn't finish \(the proposal write failed\)\. The change is held/);
    const set = fileStoreChangeSets(dir).find((s) => s.source === KEEP_SOURCE)!;
    assert.equal(set.status, "held");
    assert.match(set.held_reason ?? "", /keep-document 110714 failed part way: the proposal write failed/);
    assert.deepEqual(notes.map((n) => n.action), ["review.keep_file", "review.failed"]);
  }
  {
    const { dir, store } = await seeded();
    const { d } = deps(store, { drop: async () => Promise.reject(new Error("110714: no document f38e8289ef")) });
    const r = await keepDocument(d, form());
    assert.match((r as { message: string }).message, /^Nothing was changed: 110714: no document/);
    assert.equal(fileStoreChangeSets(dir).find((s) => s.source === KEEP_SOURCE)!.status, "applied", "an empty set never blocks a publish");
  }
});

test("keep: the Server Action checks the admin first and the typed word again before building anything", () => {
  const src = readFileSync(join(ROOT, "app/admin/data/colleges/[unit]/actions.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function keepDocumentAction"));
  const at = (s: string) => body.indexOf(s);
  assert.ok(at("await requireAdmin()") > 0);
  assert.ok(at("await requireAdmin()") < at("typedMatches(form.get(\"confirm\"), CONFIRM_KEEP)"));
  assert.ok(at("typedMatches(") < at("supabaseStore("));
  assert.ok(at("typedMatches(") < at("keepDocument("));
  assert.match(src, /^"use server";/);
  assert.match(src, /admin_note_ops/, "logged through the admin log");
});

/* ------------------------------------------------------------------ */
/* The Steward: writer and apply                                       */
/* ------------------------------------------------------------------ */

test("writer: a refile into a taken edition is refused naming both files, and a collision finding links the comparison", async () => {
  const { store } = await seeded();
  const handle = await store.open("pipeline", "steward", "t-1");
  const writer = new StewardWriter(store, handle, { run: "t-1", now: () => NOW, manifest: async (sha) => MANIFEST.get(sha) ?? null });
  const input = { kind: "refile" as const, cause: null, summary: "Refile the Drive copy", evidence: [{ unit_id: UNIT, edition: "2025-26", sha256: DRIVE, url: null, page: 1, line: 3, shows: "H.101 says 2024-2025" }], rows: [refileRow()] };
  await assert.rejects(writer.writeProposal(input), (e: unknown) => {
    assert.ok(e instanceof WriteRefused);
    assert.match(e.message, /110714 already has a 2024-25 document, 420859b8b6 \(pulled 2026-10-19 from www\.ucsc\.edu, filed as 2024–25 as the file states\), so f38e8289ef \(pulled 2026-10-26 from drive\.google\.com, filed as 2025–26 by assumption\) can't be refiled there/);
    assert.ok(e.message.includes(compareHref(UNIT, DRIVE, OFFICIAL)));
    return true;
  });
  await handle.close("applied");
  const issue = (await store.readOne<IssueDoc>(COLLECTIONS.steward.issues, collisionIssueKey(UNIT, "2024-25")))!;
  assert.equal(issue.kind, "collision");
  assert.equal(issue.href, compareHref(UNIT, DRIVE, OFFICIAL));
  assert.equal(issue.action, CHOOSE_THE_FILE);
  assert.notEqual(issue.status, "left");
  assert.deepEqual(issue.findings.map((f) => f.sha256), [OFFICIAL, DRIVE]);
  assert.match(issue.findings[1].shows, /^Pulled 2026-10-26 from drive\.google\.com/);
  assert.equal(await store.readOne(COLLECTIONS.steward.proposals, "refile-refile-the-drive-copy-t-1"), null, "no proposal written");

  // A refile into a free edition is written as before.
  const h2 = await store.open("pipeline", "steward", "t-2");
  const w2 = new StewardWriter(store, h2, { run: "t-2", now: () => NOW });
  const { doc } = await w2.writeProposal({ ...input, rows: [{ ...refileRow(), edition: "2023-24" }] });
  assert.equal(doc.kind, "refile");
  await h2.close("applied");
  assert.match(SYSTEM_PROMPT, /already has a document on the record, the refile is refused and the writer leaves a finding/);
});

test("apply: a refile that would collide is an ApplyRefused carrying the comparison's link, before anything is written", async () => {
  const { store } = await seeded();
  const handle = await store.open("pipeline", "steward-apply", "a-1");
  await assert.rejects(applyProposal(store, handle, "refile-ucsc", { today: "2026-11-08" }), (e: unknown) => {
    assert.ok(e instanceof ApplyRefused, "a refusal, not a throw: runApply closes the set applied, never held");
    assert.equal(compareLinkIn(e.message), compareHref(UNIT, "f38e8289ef", OFFICIAL));
    assert.match(e.message, /^110714 already has a 2024-25 document \(420859b8b6\), so f38e8289ef can't be refiled there; choose the file: /);
    return true;
  });
  await handle.close("applied");
  assert.equal((await store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, UNIT))!.documents.find((x) => x.sha256 === DRIVE)!.edition, "2025-26", "nothing moved");
});

/* ------------------------------------------------------------------ */
/* The Inbox                                                           */
/* ------------------------------------------------------------------ */

const inbox = (over: Partial<InboxInput>): InboxInput => ({
  now: NOW,
  decisions: [],
  proposals: [],
  todo: [],
  jobs: [],
  deletions: [],
  invitations: [],
  heldChanges: [],
  runs: [],
  counts: null,
  lastPublished: null,
  queue: null,
  health: null,
  ...over,
});

test("Inbox: a failed apply is severity 1, Choose the file when its reason carries the link, else See why it failed", () => {
  const href = compareHref(UNIT, DRIVE, OFFICIAL);
  const items = needsYou(
    inbox({
      proposals: [
        { ...proposal(), status: "failed", failed_reason: `110714 already has a 2024-25 document (420859b8b6), so f38e8289ef can't be refiled there; choose the file: ${href}`, decided_at: "2026-11-08T12:00:00Z" },
        { ...proposal(), key: "hold-x", kind: "hold", status: "failed", failed_reason: "the store was down", summary: "Hold X" },
      ],
    }),
  );
  assert.equal(items.length, 2);
  const a = items.find((i) => i.title.startsWith("Apply failed: Refile"))!;
  const b = items.find((i) => i.title === "Apply failed: Hold X")!;
  assert.deepEqual([a.severity, a.action, a.href], [1, CHOOSE_THE_FILE, href]);
  assert.match(a.title, /^Apply failed: Refile UC Santa Cruz/);
  assert.deepEqual([b.severity, b.action, b.href], [1, "See why it failed", "/admin/steward/proposals/hold-x"]);
});

test("Inbox: a held change opens the comparison when its summary carries the link, or the proposal when it only names a collision", () => {
  const href = compareHref(UNIT, DRIVE, OFFICIAL);
  const held = (id: number, reason: string | null, summary: Record<string, unknown> | null) => ({ id, kind: "pipeline", source: "steward-apply", held_reason: reason, created_at: "2026-11-08T12:00:00Z", summary });
  const items = needsYou(
    inbox({
      heldChanges: [
        held(7, "steward apply refile-ucsc failed: x", { proposal: "refile-ucsc", refused: `choose the file: ${href}` }),
        held(8, "steward apply refile-ucsc failed: 110714 already has a 2024-25 document", { proposal: "refile-ucsc", refused: "110714 already has a 2024-25 document" }),
        held(9, "a check failed", null),
      ],
    }),
  );
  const by = new Map(items.map((i) => [i.title, i]));
  assert.deepEqual([by.get("Change #7 is held")!.href, by.get("Change #7 is held")!.action], [href, CHOOSE_THE_FILE]);
  assert.deepEqual([by.get("Change #8 is held")!.href, by.get("Change #8 is held")!.action], ["/admin/steward/proposals/refile-ucsc", CHOOSE_THE_FILE]);
  assert.deepEqual([by.get("Change #9 is held")!.href, by.get("Change #9 is held")!.action], ["/admin/data/changes/9", "Review"]);
});

test("Inbox: a collision finding the Steward left is a row (severity 2); a settled one is not; no finding, no row", () => {
  const issue: IssueDoc = { key: collisionIssueKey(UNIT, "2024-25"), kind: "collision", status: "waiting", hypothesis: "Two files claim 2024-25 for 110714", findings: [], proposals: [], reason: null, run: "r1", updated: "2026-11-08T10:00:00Z", href: compareHref(UNIT, DRIVE, OFFICIAL), action: CHOOSE_THE_FILE };
  const items = needsYou(inbox({ collisions: [issue, { ...issue, key: "collision|166027|2024-25", status: "left" }] }));
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].kind, items[0].severity, items[0].action, items[0].href], ["collision", 2, CHOOSE_THE_FILE, issue.href]);
  assert.equal(needsYou(inbox({})).length, 0);
  const page = readFileSync(join(ROOT, "app/admin/page.tsx"), "utf8");
  assert.match(page, /collision: "Two files"/, "the Inbox names the row's kind");
});

test("Help: the new entries exist, under Data", async () => {
  const { HELP } = await import("../lib/admin/help.ts");
  for (const key of ["documents", "document-collision", "keep-file", "pulled-from", "filed-by"]) {
    assert.ok(isHelpKey(key), key);
    assert.equal((HELP as Record<string, { door?: string }>)[key].door, "data", key);
  }
});

/* ------------------------------------------------------------------ */
/* The Documents panel, rendered with stand-ins                        */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const tmp = mkdtempSync(join(tmpdir(), "documents-panel-"));
const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
function stubModule(name: string, names: string[]): string {
  const file = join(tmp, `stub-${name}.mjs`);
  writeFileSync(
    file,
    `import React from ${JSON.stringify(reactUrl)};
const make = (n) => ({ children, ...props }) => {
  const plain = Object.fromEntries(Object.entries(props).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) || v === null));
  return React.createElement("div", { "data-stub": n, "data-props": JSON.stringify(plain) }, children);
};
${names.map((n) => `export const ${n} = make(${JSON.stringify(n)});`).join("\n")}\n`,
  );
  return pathToFileURL(file).href;
}
async function loadTsx(rel: string): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  let n = 0;
  const code = outputText.replace(/import \{([^}]*)\} from "(@\/(?:components|app)\/[^"]+)";/g, (_m, names: string, spec: string) => {
    if (spec.endsWith("/ResponsiveTable")) return `import { ResponsiveTable } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "fixtures/responsive-table-fake.mjs")).href)};`;
    const list = names.split(",").map((s) => s.trim().split(" as ").pop()!.trim()).filter(Boolean);
    return `import {${names}} from ${JSON.stringify(stubModule(`${n++}-${spec.split("/").pop()!.replace(/[^a-z]/gi, "_")}`, list))};`;
  });
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}
const stubsIn = (markup: string) => [...markup.matchAll(/data-stub="(\w+)" data-props="([^"]*)"/g)].map((m) => ({ name: m[1], props: JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'")) as Record<string, unknown> }));

const docsOf = (rec: CollegeRecord) => ({ record: rec, manifest: new Map(MANIFEST), queue: new Map([[DRIVE, 367], [OFFICIAL, 63]]) });

test("Documents panel: a card per file; a collision puts the two files side by side with what differs and Keep this file under each", async () => {
  const mod = (await loadTsx("components/admin/DocumentsPanel.tsx")) as { DocumentsPanel: (p: Record<string, unknown>) => import("react").ReactElement };
  const plain = renderToStaticMarkup(mod.DocumentsPanel({ unit: UNIT, docs: docsOf(record()), compare: null, template: CDS_TEMPLATE }));
  const panel = stubsIn(plain).find((s) => s.name === "Panel")!;
  assert.deepEqual([panel.props.help, panel.props.title, panel.props.id], ["documents", "Documents", "documents"]);
  assert.match(plain, /Pulled 2026-10-26 from drive\.google\.com \(the full address under Details\); filed as 2025–26 by assumption; read by Sonnet on 2026-10-26: 8 of 1,105 items, 8 with check failures\./);
  assert.match(plain, /Pulled 2026-10-19 from www\.ucsc\.edu/);
  assert.ok(plain.indexOf("2025–26 · drive.google.com") < plain.indexOf("2024–25 · www.ucsc.edu"), "newest edition first");
  assert.doesNotMatch(plain, /Keep this file|claim|Compare two files/, "no collision, no comparison");
  assert.match(plain, /https:\/\/drive\.usercontent\.google\.com\/download\?id=1UCSCcds/, "the final address under Details");

  const clash = renderToStaticMarkup(mod.DocumentsPanel({ unit: UNIT, docs: docsOf(colliding()), compare: null, template: CDS_TEMPLATE }));
  assert.match(clash, /Two files claim 2024–25/);
  assert.match(clash, /md:grid-cols-2/, "side by side from md, stacked below");
  assert.ok(clash.indexOf("Pulled 2026-10-26") < clash.indexOf("What differs"), "the facts first");
  assert.match(clash, /4 items read in both agree; 3 differ\./);
  assert.match(clash, /data-col="a">30,120<\/div><div data-col="b">30,012/, "File A is the newest pull");
  assert.match(clash, /Only one file read it: 1 in File A, 2 in File B/);
  const keeps = stubsIn(clash).filter((s) => s.name === "ConfirmTyped");
  assert.equal(keeps.length, 2);
  for (const k of keeps) {
    assert.equal(k.props.trigger, "Keep this file");
    assert.equal(k.props.expected, CONFIRM_KEEP);
    assert.equal(k.props.sheet, true);
  }
  assert.match(keeps[0].props.description as string, /^The other file \(pulled 2026-10-19 from www\.ucsc\.edu\) is dropped from this college: its 63 queue items go/);
  assert.match(keeps[1].props.description as string, /^The other file \(pulled 2026-10-26 from drive\.google\.com\) is dropped from this college: its 367 queue items go/);

  const linked = renderToStaticMarkup(mod.DocumentsPanel({ unit: UNIT, docs: docsOf(record()), compare: ["f38e8289ef", "420859b8b6"], template: CDS_TEMPLATE }));
  assert.match(linked, /Compare two files/, "a refile collision's link compares across editions");
  assert.match(linked, /File A is filed under 2025–26, File B under 2024–25/);
  const unknown = renderToStaticMarkup(mod.DocumentsPanel({ unit: UNIT, docs: docsOf(record()), compare: ["abcdef1234", "420859b8b6"], template: CDS_TEMPLATE }));
  assert.doesNotMatch(unknown, /Compare two files/, "a link to a file the record doesn't hold shows the cards only");

  assert.match(renderToStaticMarkup(mod.DocumentsPanel({ unit: UNIT, docs: null, compare: null, template: CDS_TEMPLATE })), /Couldn&#x27;t read this college/);
  assert.match(renderToStaticMarkup(mod.DocumentsPanel({ unit: UNIT, docs: { record: null, manifest: new Map(), queue: new Map() }, compare: null, template: CDS_TEMPLATE })), /No Common Data Set file is on record/);
});

test("the college page reads the compare query and renders the Documents panel", () => {
  const page = readFileSync(join(ROOT, "app/admin/data/colleges/[unit]/page.tsx"), "utf8");
  assert.match(page, /parseCompare\(query\.compare\)/);
  assert.match(page, /<DocumentsPanel unit=\{unit\} docs=\{documents\} compare=\{compare\}/);
  const doc: DocumentRecord = DRIVE_DOC;
  assert.ok(doc.sha256.startsWith("f38e8289ef"));
});
