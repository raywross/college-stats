/**
 * The archive and the "read once" rules (specs/college-reported-round-3.md Decisions 1, 8, 10; tests 1, 2, 13): local
 * and GitHub-release backends, the gzip line sidecar, needsFetch, callsNeedingRead, priorEditionLinks, and
 * `archive-doc` end to end on a real template workbook. Each guard is broken on purpose where the spec asks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { CallRead, CollegeDocsFile, DocumentRecord, ManifestEntry } from "../lib/cds-sections.ts";
import { addMonth, callsNeedingRead, documentsOf, fetchOutcome, findBySha, manifestEntryFor, needsFetch } from "../lib/cds-reads.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { validateCdsRecords } from "../lib/cds-records.ts";
import { createArchive, priorEditionLinks, LocalArchive } from "../scripts/lib/college-reported/archive.mts";
import { addOwnerUrl, archiveDoc } from "../scripts/lib/college-reported/archive-doc.mts";
import { sha256 } from "../scripts/lib/college-reported/http.mts";
import { readManifest, readRecords } from "../scripts/lib/college-reported/records.mts";
import type { School } from "../lib/types.ts";

const ROOT_SCHOOLS: School[] = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "schools.json"), "utf8"));
const schoolOf = (id: string) => ROOT_SCHOOLS.find((s) => s.unit_id === id) ?? null;

const tmp = () => mkdtempSync(join(tmpdir(), "cds-archive-"));
const bytesOf = (s: string) => new Uint8Array(Buffer.from(s));

/* ------------------------------------------------------------------ */
/* Local backend                                                       */
/* ------------------------------------------------------------------ */

test("local archive: put/get round trip by sha256, idempotent, refuses bytes that don't hash to the key", async () => {
  const dir = tmp();
  try {
    const a = createArchive({ dir, env: {} });
    assert.equal(a.backend, "local");
    const b = bytesOf("%PDF-1.7 a college's CDS");
    const sha = sha256(b);
    assert.equal(await a.has(sha), false);
    assert.equal(await a.get(sha), null);
    assert.equal(await a.put(sha, b, "pdf"), `local:${sha}.pdf`);
    assert.equal(await a.has(sha), true);
    assert.deepEqual(await a.get(sha), b);
    assert.ok(existsSync(join(dir, `${sha}.pdf`)));
    // A second put is a no-op that reports where the bytes already are.
    assert.equal(await a.put(sha, b, "pdf"), `local:${sha}.pdf`);
    assert.deepEqual(readdirSync(dir), [`${sha}.pdf`]);
    await assert.rejects(a.put(sha, bytesOf("other bytes"), "pdf"), /don't hash/);
    await assert.rejects(a.get("not-a-sha"), /isn't a sha256/);
    await assert.rejects(a.put(sha, b, "../x"), /bad extension/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local archive: the line sidecar is gzipped JSON beside the document and doesn't count as the document", async () => {
  const dir = tmp();
  try {
    const a = createArchive({ dir, env: {} });
    const b = bytesOf("%PDF-1.7 lines");
    const sha = sha256(b);
    const lines = { pages: [["1 | Common Data Set 2025-2026"], ["2 | C1 | 50,000"]] };
    assert.equal(await a.putLines(sha, lines), `local:${sha}.lines.json.gz`);
    const raw = readFileSync(join(dir, `${sha}.lines.json.gz`));
    assert.deepEqual(JSON.parse(gunzipSync(raw).toString("utf8")), lines);
    assert.deepEqual(await a.getLines(sha), lines);
    assert.equal(await a.has(sha), false, "a sidecar alone isn't the archived document");
    assert.equal(await a.getLines(sha256(bytesOf("nothing"))), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createArchive picks the backend from the environment and refuses a repo without a token", () => {
  const dir = tmp();
  try {
    assert.equal(createArchive({ dir, env: {} }).backend, "local");
    assert.equal(createArchive({ dir, env: { COLLEGE_DOCS_REPO: "owner/quad-college-docs", GITHUB_TOKEN: "t" } }).backend, "github-release");
    assert.throws(() => createArchive({ dir, env: { COLLEGE_DOCS_REPO: "owner/quad-college-docs" } }), /TOKEN/);
    assert.throws(() => createArchive({ dir, env: { COLLEGE_DOCS_REPO: "quad-college-docs", GITHUB_TOKEN: "t" } }), /owner\/name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* GitHub release backend, through a fake API                         */
/* ------------------------------------------------------------------ */

function fakeGitHub(repo = "owner/docs") {
  const releases: { id: number; tag_name: string; assets: { id: number; name: string; bytes: Uint8Array }[] }[] = [];
  const calls: string[] = [];
  let nextId = 100;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.host}${url.pathname}`);
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== "Bearer tok") return json(401, { message: "bad credentials" });
    const p = url.pathname.replace(`/repos/${repo}`, "");
    let m: RegExpExecArray | null;
    if (method === "GET" && p === "/releases") {
      const page = Number(url.searchParams.get("page") ?? 1);
      return json(200, page === 1 ? releases.map(({ id, tag_name }) => ({ id, tag_name })) : []);
    }
    if (method === "POST" && p === "/releases") {
      const body = JSON.parse(String(init!.body)) as { tag_name: string };
      if (releases.some((r) => r.tag_name === body.tag_name)) return json(422, { message: "already_exists" });
      const r = { id: nextId++, tag_name: body.tag_name, assets: [] };
      releases.push(r);
      return json(201, { id: r.id, tag_name: r.tag_name });
    }
    if (method === "GET" && (m = /^\/releases\/(\d+)\/assets$/.exec(p))) {
      const r = releases.find((r) => r.id === Number(m![1]))!;
      const page = Number(url.searchParams.get("page") ?? 1);
      return json(200, page === 1 ? r.assets.map(({ id, name }) => ({ id, name })) : []);
    }
    if (method === "POST" && url.host === "uploads.example" && (m = /^\/releases\/(\d+)\/assets$/.exec(p))) {
      const r = releases.find((r) => r.id === Number(m![1]))!;
      const name = url.searchParams.get("name")!;
      if (r.assets.some((a) => a.name === name)) return json(422, { message: "already_exists" });
      const a = { id: nextId++, name, bytes: new Uint8Array(init!.body as Uint8Array) };
      r.assets.push(a);
      return json(201, { id: a.id, name });
    }
    if (method === "GET" && (m = /^\/releases\/assets\/(\d+)$/.exec(p))) {
      const a = releases.flatMap((r) => r.assets).find((a) => a.id === Number(m![1]));
      return a ? new Response(new Uint8Array(a.bytes), { status: 200 }) : json(404, {});
    }
    return json(404, { message: `no route ${method} ${p}` });
  }) as typeof globalThis.fetch;
  return { fetch, releases, calls };
}

const ghOpts = (dir: string, gh: ReturnType<typeof fakeGitHub>, month = "2026-10-06T12:00:00Z", assetLimit?: number) => ({
  dir,
  env: { COLLEGE_DOCS_REPO: "owner/docs", COLLEGE_REPORTED_TOKEN: "tok" },
  fetch: gh.fetch,
  now: () => new Date(month),
  apiBase: "https://api.example",
  uploadBase: "https://uploads.example",
  ...(assetLimit ? { assetLimit } : {}),
});

test("github archive: uploads once into the month's release; a second put is a no-op; get downloads into the hot cache", async () => {
  const gh = fakeGitHub();
  const dirA = tmp();
  const dirB = tmp();
  try {
    const a = createArchive(ghOpts(dirA, gh));
    assert.equal(a.backend, "github-release");
    const b = bytesOf("PK workbook bytes");
    const sha = sha256(b);
    assert.equal(await a.has(sha), false);
    assert.equal(await a.put(sha, b, "xlsx"), `gh:docs-2026-10/${sha}.xlsx`);
    assert.equal(gh.releases.length, 1);
    assert.equal(gh.releases[0].tag_name, "docs-2026-10");
    assert.deepEqual(gh.releases[0].assets.map((x) => x.name), [`${sha}.xlsx`]);
    const uploads = () => gh.calls.filter((c) => c.startsWith("POST uploads.example")).length;
    assert.equal(uploads(), 1);
    assert.equal(await a.put(sha, b, "xlsx"), `gh:docs-2026-10/${sha}.xlsx`);
    assert.equal(uploads(), 1, "second put uploads nothing");
    assert.ok(existsSync(join(dirA, `${sha}.xlsx`)), "the local directory stays a hot cache");

    // A later run on another machine (empty cache), another month: has/get find it in last month's release.
    const later = createArchive(ghOpts(dirB, gh, "2026-11-02T00:00:00Z"));
    assert.equal(await later.has(sha), true);
    assert.equal(await later.put(sha, b, "xlsx"), `gh:docs-2026-10/${sha}.xlsx`, "never re-uploaded into a new month");
    rmSync(join(dirB, `${sha}.xlsx`));
    const downloads = () => gh.calls.filter((c) => /GET api\.example.*\/releases\/assets\/\d+$/.test(c)).length;
    assert.deepEqual(await later.get(sha), b);
    assert.equal(downloads(), 1);
    assert.ok(existsSync(join(dirB, `${sha}.xlsx`)));
    assert.deepEqual(await later.get(sha), b);
    assert.equal(downloads(), 1, "second get reads the hot cache");

    // The line sidecar goes up beside it and comes back through an empty cache.
    await a.putLines(sha, ["1 | C1"]);
    const third = createArchive(ghOpts(tmp(), gh));
    assert.deepEqual(await third.getLines(sha), ["1 | C1"]);
    assert.equal(await third.get(sha256(bytesOf("never archived"))), null);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("github archive: a full release opens the month's next one", async () => {
  const gh = fakeGitHub();
  const dir = tmp();
  try {
    const a = createArchive(ghOpts(dir, gh, "2026-10-06T00:00:00Z", 2));
    const locs: string[] = [];
    for (const s of ["one", "two", "three"]) {
      const b = bytesOf(s);
      locs.push(await a.put(sha256(b), b, "pdf"));
    }
    assert.deepEqual(gh.releases.map((r) => [r.tag_name, r.assets.length]), [["docs-2026-10", 2], ["docs-2026-10.2", 1]]);
    assert.ok(locs[2].startsWith("gh:docs-2026-10.2/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* needsFetch / fetchOutcome (Decision 10)                             */
/* ------------------------------------------------------------------ */

const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  sha256: "a".repeat(64),
  unit_id: "166027",
  url: "https://oira.example.edu/CDS_2025-2026.pdf",
  kind: "cds",
  type: "pdf-flat",
  edition: "2025-26",
  retrieved: "2026-10-06",
  bytes: 1000,
  archive: "local:x.pdf",
  ...over,
});

test("needsFetch: new → fetch; known → conditional GET only when the index changed or a month passed", () => {
  assert.deepEqual(needsFetch(undefined, { today: "2026-10-06", indexChanged: false }), { fetch: true, reason: "new", conditional: {} });
  const e = entry();
  const v = { etag: '"abc"', last_modified: "Tue, 06 Oct 2026 00:00:00 GMT" };
  assert.deepEqual(needsFetch(e, { ...v, today: "2026-10-20", indexChanged: false }), { fetch: false, reason: "checked-this-month" });
  assert.deepEqual(needsFetch(e, { ...v, today: "2026-10-20", indexChanged: true }), { fetch: true, reason: "index-changed", conditional: v });
  assert.deepEqual(needsFetch(e, { ...v, today: "2026-11-06", indexChanged: false }), { fetch: true, reason: "monthly", conditional: v });
  // The last check, not the first retrieval, starts the month.
  assert.equal(needsFetch(e, { lastChecked: "2026-11-06", today: "2026-11-30", indexChanged: false }).fetch, false);
  assert.equal(needsFetch(e, { lastChecked: "2026-11-06", today: "2026-12-06", indexChanged: false }).fetch, true);
  // Calendar months: a monthly run on the 1st isn't skipped in a 28-day February.
  assert.equal(needsFetch(entry({ retrieved: "2027-02-01" }), { today: "2027-03-01", indexChanged: false }).fetch, true);
  assert.equal(addMonth("2026-01-31"), "2026-02-28");
  assert.equal(addMonth("2026-12-15"), "2027-01-15");
});

test("fetchOutcome: a 304 or an archived sha256 ends it; new bytes are a new document", () => {
  const m: CollegeDocsFile = { updated: null, documents: [entry()] };
  assert.equal(fetchOutcome(m, { status: 304 }), "unchanged");
  assert.equal(fetchOutcome(m, { status: 200, sha256: "a".repeat(64) }), "unchanged");
  assert.equal(fetchOutcome(m, { status: 200, sha256: "b".repeat(64) }), "new-document");
  assert.equal(fetchOutcome(m, { status: 404 }), "failed");
});

test("manifest helpers: manifestEntryFor drops empty fields; findBySha; documentsOf newest first", () => {
  const e = manifestEntryFor({
    sha256: "c".repeat(64), unit_id: "166027", url: "https://x.edu/a.pdf", final_url: "https://x.edu/a.pdf", kind: "cds", type: "pdf-flat",
    edition: "2025-26", edition_from: "cover", retrieved: "2026-10-06", bytes: 10, pages: 34, body_chars: null, sections: {}, archive: "local:c.pdf",
  });
  assert.deepEqual(Object.keys(e), ["sha256", "unit_id", "url", "kind", "type", "edition", "retrieved", "bytes", "archive", "edition_from", "pages"]);
  assert.throws(() => manifestEntryFor({ ...e, sha256: "nope" }), /sha256/);
  assert.throws(() => manifestEntryFor({ ...e, retrieved: "Oct 6" }), /ISO date/);
  const m: CollegeDocsFile = { updated: null, documents: [entry({ edition: "2024-25", sha256: "1".repeat(64) }), e, entry({ unit_id: "1", sha256: "2".repeat(64) })] };
  assert.equal(findBySha(m, e.sha256), e);
  assert.equal(findBySha(m, "f".repeat(64)), undefined);
  assert.deepEqual(documentsOf(m, "166027").map((d) => d.edition), ["2025-26", "2024-25"]);
});

/* ------------------------------------------------------------------ */
/* callsNeedingRead (Decision 1 "Schema versions"; test 2)             */
/* ------------------------------------------------------------------ */

const read = (v: number, mode: CallRead["mode"] = "batch", by = "claude-haiku-4-5"): CallRead => ({ schema_version: v, read_by: by, mode, extracted: "2026-10-06" });
const doc = (type: DocumentRecord["type"], reads: DocumentRecord["reads"]) => ({ type, reads });

test("callsNeedingRead: same versions → nothing; a bumped C → only C; a missing call → that call", () => {
  const flat = doc("pdf-flat", { C: read(1), rest: read(1) });
  assert.deepEqual(callsNeedingRead(flat, { C: 1, rest: 1 }), []);
  assert.deepEqual(callsNeedingRead(flat, { C: 2, rest: 1 }), ["C"]);
  assert.deepEqual(callsNeedingRead(flat, { C: 2, rest: 2 }), ["C", "rest"]);
  assert.deepEqual(callsNeedingRead(doc("html", { C: read(1) }), { C: 1, rest: 1 }), ["rest"]);
  assert.deepEqual(callsNeedingRead(doc("pdf-scanned", {}), { C: 1, rest: 1 }), ["C", "rest"]);
});

test("callsNeedingRead: template workbooks and form PDFs never go to a model; a reader bump re-runs the deterministic read", () => {
  const tpl = doc("xlsx-template", { deterministic: read(1, "deterministic", "xlsx-template") });
  assert.deepEqual(callsNeedingRead(tpl, { C: 9, rest: 9 }, { "xlsx-template": 1, "pdf-form": 1 }), []);
  assert.deepEqual(callsNeedingRead(tpl, { C: 1, rest: 1 }, { "xlsx-template": 2, "pdf-form": 1 }), ["deterministic"]);
  assert.deepEqual(callsNeedingRead(doc("pdf-form", {}), { C: 1, rest: 1 }, { "xlsx-template": 1, "pdf-form": 1 }), ["deterministic"]);
  assert.deepEqual(callsNeedingRead(doc("class-profile", {})), []);
});

test("callsNeedingRead on the committed records: no call read at today's version is due again; a C bump touches no template workbook", () => {
  const recs = readRecords(join(import.meta.dirname, "..", "data", "cds-records"));
  assert.ok(recs.length >= 4);
  for (const r of recs) {
    for (const d of r.documents) {
      // A call is due only when the record never read it (a run's failed call, e.g. Houston's rest call that was too
      // long for Haiku in run 20261004-011421-7), never one already read at today's version.
      const due = callsNeedingRead(d);
      for (const call of due) assert.equal((d.reads as Record<string, unknown>)[call], undefined, `${r.unit_id} ${d.sha256.slice(0, 8)} ${call} was read but is due`);
      if (d.type === "xlsx-template" || d.type === "pdf-form") assert.deepEqual(due, [], `${r.unit_id}: deterministic documents are never due`);
      if (d.type === "xlsx-template") assert.deepEqual(callsNeedingRead(d, { C: 99, rest: 99 }), []);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Prior editions                                                      */
/* ------------------------------------------------------------------ */

test("priorEditionLinks: older CDS editions only, one per edition, Excel preferred, newest first", () => {
  const links = [
    { url: "https://ir.x.edu/CDS_2025-2026.pdf", text: "Common Data Set 2025-2026" },
    { url: "https://ir.x.edu/CDS_2024-2025.pdf", text: "Common Data Set 2024-2025" },
    { url: "https://ir.x.edu/CDS_2024-2025.xlsx", text: "Excel" },
    { url: "https://ir.x.edu/uploads/2024/09/CDS_2023-2024.pdf", text: "2023-24" },
    { url: "https://ir.x.edu/class-profile-2024", text: "Class profile" },
    { url: "https://ir.x.edu/factbook-2022.pdf", text: "Factbook" },
  ];
  const got = priorEditionLinks(links, "2025-26");
  assert.deepEqual(got.map((l) => [l.edition, l.url.split("/").pop()]), [["2024-25", "CDS_2024-2025.xlsx"], ["2023-24", "CDS_2023-2024.pdf"]]);
  assert.equal(priorEditionLinks(links, "2025-26", 1).length, 1);
  assert.throws(() => priorEditionLinks(links, "next year"));
});

/* ------------------------------------------------------------------ */
/* archive-doc end to end (Decision 8; test 13's archive-doc part)     */
/* ------------------------------------------------------------------ */

// The 2026-10-03 inventory's William & Mary workbook (~1 MB, not committed); CDS_INVENTORY_DOCS points elsewhere.
const INVENTORY =
  process.env.CDS_INVENTORY_DOCS ??
  "/private/tmp/claude-501/-Users-raymondross-Projects-college-stats-college-stats--claude-worktrees-cr2/2bb2276a-cba1-46a0-950b-762026d91617/scratchpad/inventory/cds-gap/docs";
const WM = join(INVENTORY, "wm.xlsx");

test("archive-doc: a template workbook is archived, listed, and read with no model, and passes validateCdsRecords", { skip: !existsSync(WM) && "inventory workbook not on this machine" }, async () => {
  const data = tmp();
  const cache = tmp();
  try {
    const archive = new LocalArchive(cache);
    const url = "https://www.wm.edu/offices/ir/university_data/cds/wm-2025-2026-cds1.xlsx";
    const res = await archiveDoc({ unit_id: "231624", file: WM, url, retrieved: "2026-10-03", addUrl: true, note: "test", dataDir: data, archive, table: CDS_TEMPLATE, school: schoolOf("231624") });
    const sha = sha256(new Uint8Array(readFileSync(WM)));
    assert.equal(res.entry.sha256, sha);
    assert.equal(res.entry.type, "xlsx-template");
    assert.equal(res.entry.edition, "2025-26");
    assert.equal(res.entry.archive, `local:${sha}.xlsx`);
    assert.ok(await archive.has(sha));
    assert.ok(res.record);
    assert.equal(res.addedUrl, true);

    const manifest = readManifest(join(data, "college-docs.json"));
    const records = readRecords(join(data, "cds-records"));
    assert.deepEqual(validateCdsRecords(records, manifest, CDS_TEMPLATE), []);
    // Same bytes and items as the committed record built by cds-records-from-workbooks.
    const committed = readRecords(join(import.meta.dirname, "..", "data", "cds-records")).find((r) => r.unit_id === "231624")!;
    assert.equal(committed.documents[0].sha256, sha);
    assert.deepEqual(records[0].documents[0].items, committed.documents[0].items);
    const urls = JSON.parse(readFileSync(join(data, "reference", "cds-urls.json"), "utf8"));
    assert.deepEqual(urls.entries, [{ unit_id: "231624", url, kind: "cds", note: "test", added: "2026-10-03" }]);

    // Re-running changes nothing; the same file for another college is refused.
    const before = readFileSync(join(data, "college-docs.json"), "utf8");
    const again = await archiveDoc({ unit_id: "231624", file: WM, url, retrieved: "2026-10-03", addUrl: true, dataDir: data, archive, table: CDS_TEMPLATE, school: schoolOf("231624") });
    assert.equal(again.addedUrl, false);
    assert.equal(readFileSync(join(data, "college-docs.json"), "utf8"), before);
    await assert.rejects(archiveDoc({ unit_id: "221999", file: WM, url, dataDir: data, archive, table: CDS_TEMPLATE }), /already archived for college 231624/);

    // The validator's guard: the record without its manifest entry fails.
    assert.match(validateCdsRecords(records, { updated: null, documents: [] }, CDS_TEMPLATE).join("\n"), /sha256 isn't in data\/college-docs.json/);
  } finally {
    rmSync(data, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test("archive-doc: a non-template file is archived and listed, with no record until the pipeline reads it", async () => {
  const data = tmp();
  const cache = tmp();
  try {
    const file = join(data, "profile.html");
    writeFileSync(file, "<html><body><h1>Class of 2029 profile</h1></body></html>");
    const res = await archiveDoc({ unit_id: "166027", file, url: "https://admissions.x.edu/profile", kind: "class-profile", retrieved: "2026-10-03", dataDir: data, archive: new LocalArchive(cache), table: CDS_TEMPLATE });
    assert.equal(res.entry.type, "class-profile");
    assert.equal(res.entry.edition, null);
    assert.equal(res.record, null);
    assert.ok(res.entry.archive?.endsWith(".html"));
    assert.equal(readManifest(join(data, "college-docs.json")).documents.length, 1);
    assert.equal(existsSync(join(data, "cds-records")), false);
    assert.equal(addOwnerUrl(join(data, "reference", "cds-urls.json"), { unit_id: "1", url: "u", kind: "cds", added: "2026-10-03" }), true);
  } finally {
    rmSync(data, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});
