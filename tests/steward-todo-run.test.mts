/**
 * The To do list's agentic half (specs/product/todo-browser-agent.md): a Found row's address joins the owner's list
 * and the run closes the row once it holds the document (lib/steward/todo-run.ts); what an address answers is
 * classified from its bytes and status, never its URL (lib/steward/todo-verify.ts); and the assistant view takes only
 * the rows it may work, logins on listed hosts included (lib/steward/todo-assistant.ts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CdsUrlEntry } from "../lib/reported.ts";
import { foundEntries, isRunnableFound, settleFound, withFound } from "../lib/steward/todo-run.ts";
import { classifyAnswer, errorVerdict, isPublicAddress, verdictMessage, verdictRecord } from "../lib/steward/todo-verify.ts";
import { ASSISTANT_BATCH, assistantCanWork, assistantRows, loginFor, loginFromFields, loginKey } from "../lib/steward/todo-assistant.ts";
import { PROBE_USER_AGENT, probeDocument } from "../lib/admin/todo-probe.ts";
import { USER_AGENT } from "../scripts/lib/college-reported/http.mts";
import type { LoginDoc, TodoDoc } from "../lib/steward/types.ts";

const row = (over: Partial<TodoDoc> = {}): TodoDoc => ({
  key: "cds:190415:2025-26",
  kind: "cds",
  unit_id: "190415",
  subject: "Cornell University",
  edition: "2025-26",
  landing: "https://irp.cornell.edu/cds",
  document_url: null,
  host: "irp.cornell.edu",
  why: "challenge",
  reach: 1,
  demand: 0,
  status: "open",
  route: null,
  attempts: [],
  note: null,
  updated: "2026-11-08T10:00:00Z",
  ...over,
});
const found = (over: Partial<TodoDoc> = {}) => row({ status: "found", document_url: "https://irp.cornell.edu/files/CDS_2025-26.pdf#page=2", route: "person", ...over });

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

test("a found row of a kind the run fetches, with an http(s) address and a college, is runnable; the rest stay notes to a person", () => {
  assert.ok(isRunnableFound(found()));
  assert.ok(isRunnableFound(found({ kind: "class-profile" })));
  assert.ok(!isRunnableFound(row()), "open");
  assert.ok(!isRunnableFound(found({ status: "done" })));
  assert.ok(!isRunnableFound(found({ unit_id: null })), "no college");
  assert.ok(!isRunnableFound(found({ kind: "campus-page" })), "not a kind the run fetches");
  assert.ok(!isRunnableFound(found({ document_url: "javascript:alert(1)" })));
  assert.ok(!isRunnableFound(found({ document_url: null })));
});

test("foundEntries: one owner's-list entry per runnable row, the fragment dropped, the key in the note, the day it was marked", () => {
  const entries = foundEntries([found(), row(), found({ key: "class-profile:190415:-", kind: "class-profile", document_url: "https://admissions.cornell.edu/profile.pdf", updated: "2026-11-07T23:59:00Z" })]);
  assert.deepEqual(entries, [
    { unit_id: "190415", url: "https://irp.cornell.edu/files/CDS_2025-26.pdf", kind: "cds", note: "To do cds:190415:2025-26: found in a browser", added: "2026-11-08" },
    { unit_id: "190415", url: "https://admissions.cornell.edu/profile.pdf", kind: "class-profile", note: "To do class-profile:190415:-: found in a browser", added: "2026-11-07" },
  ]);
});

test("withFound: the owner's list keeps its order and gains only the addresses it doesn't hold for that college", () => {
  const manual: CdsUrlEntry[] = [
    { unit_id: "190415", url: "https://irp.cornell.edu/files/CDS_2025-26.pdf", kind: "cds", added: "2026-10-13" },
    { unit_id: "100751", url: "https://oira.ua.edu/cds.pdf", kind: "cds", added: "2026-10-13" },
  ];
  const out = withFound(manual, [found(), found({ key: "cds:100751:2025-26", unit_id: "100751", document_url: "https://oira.ua.edu/new/cds-2025-26.pdf" })]);
  assert.deepEqual(
    out.map((e) => `${e.unit_id} ${e.url}`),
    ["190415 https://irp.cornell.edu/files/CDS_2025-26.pdf", "100751 https://oira.ua.edu/cds.pdf", "100751 https://oira.ua.edu/new/cds-2025-26.pdf"],
  );
  assert.equal(out[0].added, "2026-10-13", "the owner's own entry is untouched");
});

test("settleFound: the row at the fetched address (or where it led) becomes done with the run's attempt; other rows and colleges are untouched", () => {
  const rows = [found(), found({ key: "cds:100751:2025-26", unit_id: "100751", document_url: "https://oira.ua.edu/cds.pdf" }), row({ key: "cds:1:-", unit_id: "1" })];
  const { rows: next, settled } = settleFound(rows, { unit_id: "190415", urls: ["https://irp.cornell.edu/cds-link", "https://irp.cornell.edu/files/CDS_2025-26.pdf"], sha256: "abcdef0123456789".repeat(4), at: "2026-11-09T03:00:00Z" });
  assert.equal(settled.length, 1);
  assert.deepEqual([next[0].status, next[0].updated, next[0].attempts.at(-1)], ["done", "2026-11-09T03:00:00Z", { at: "2026-11-09T03:00:00Z", route: "run", result: "archived abcdef012345" }]);
  assert.equal(next[1], rows[1], "another college's row is the same object");
  assert.equal(next[2], rows[2]);
  const none = settleFound(rows, { unit_id: "190415", urls: ["https://irp.cornell.edu/other.pdf"], sha256: "0".repeat(64), at: "2026-11-09T03:00:00Z" });
  assert.equal(none.settled.length, 0);
  assert.deepEqual(none.rows, rows);
});

/* ------------------------------------------------------------------ */
/* What an address answers                                              */
/* ------------------------------------------------------------------ */

const headers = (h: Record<string, string> = {}) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

test("classifyAnswer: the bytes first (a PDF or a workbook is a document whatever the status), then the status, then the page", () => {
  assert.deepEqual(classifyAnswer({ status: 200, headers: headers({ "content-type": "application/octet-stream" }), head: bytes("%PDF-1.7\n%âãÏÓ") }), { outcome: "document", format: "pdf", detail: "a PDF" });
  assert.deepEqual(classifyAnswer({ status: 200, headers: headers(), head: bytes("PK\u0003\u0004rest") }), { outcome: "document", format: "xlsx", detail: "a workbook" });
  assert.equal(classifyAnswer({ status: 403, headers: headers(), head: bytes("<html><title>Just a moment...</title>") }).detail, "a bot challenge");
  assert.equal(classifyAnswer({ status: 503, headers: headers({ "cf-mitigated": "challenge" }), head: bytes("") }).outcome, "blocked");
  assert.deepEqual(classifyAnswer({ status: 403, headers: headers(), head: bytes("Forbidden") }), { outcome: "blocked", detail: "HTTP 403" });
  assert.equal(classifyAnswer({ status: 429, headers: headers(), head: bytes("") }).outcome, "blocked");
  assert.deepEqual(classifyAnswer({ status: 404, headers: headers(), head: bytes("<html>Not found") }), { outcome: "not-found", detail: "HTTP 404" });
  assert.equal(classifyAnswer({ status: 500, headers: headers(), head: bytes("") }).outcome, "error");
  assert.deepEqual(classifyAnswer({ status: 200, headers: headers({ "content-type": "text/html; charset=utf-8" }), head: bytes("<!doctype html><html>") }), { outcome: "page", detail: "a web page" });
  assert.deepEqual(classifyAnswer({ status: 200, headers: headers({ "content-type": "application/json" }), head: bytes('{"a":1}') }), { outcome: "page", detail: "application/json, not a file we read" });
  assert.deepEqual(errorVerdict(new DOMException("The operation was aborted", "AbortError")), { outcome: "error", detail: "no answer in time" });
  assert.deepEqual(errorVerdict(new Error("getaddrinfo ENOTFOUND nope.edu")), { outcome: "error", detail: "no such host" });
});

test("the words: the attempt's record and the sentence after Found, one per outcome", () => {
  assert.equal(verdictRecord({ outcome: "document", format: "pdf", detail: "a PDF" }), "a PDF answers");
  assert.equal(verdictRecord({ outcome: "blocked", detail: "HTTP 403" }), "HTTP 403: the host refuses machines");
  assert.equal(verdictRecord({ outcome: "page", detail: "a web page" }), "a web page answers, not a file");
  assert.equal(verdictRecord({ outcome: "not-found", detail: "HTTP 404" }), "HTTP 404: nothing at that address for us");
  assert.equal(verdictRecord({ outcome: "error", detail: "no answer in time" }), "couldn't check: no answer in time");
  assert.equal(verdictMessage(null), "Found. The next run of this college fetches it.");
  assert.match(verdictMessage({ outcome: "document", format: "pdf", detail: "a PDF" }), /^Found\. A PDF answers at that address; the next run of this college fetches it\.$/);
  assert.match(verdictMessage({ outcome: "page", detail: "a web page" }), /find the file's own link and mark Found again/);
  assert.match(verdictMessage({ outcome: "blocked", detail: "HTTP 403" }), /refuses machines \(HTTP 403\).*archive-doc/);
  assert.match(verdictMessage({ outcome: "not-found", detail: "HTTP 404" }), /treats machines differently/);
  assert.match(verdictMessage({ outcome: "error", detail: "no such host" }), /couldn't be checked from here \(no such host\)/);
});

test("probeDocument: the pipeline's identity, one request, the first bytes only, the body cancelled; a hang is an error verdict, never a throw", async () => {
  assert.equal(PROBE_USER_AGENT, USER_AGENT, "the console checks an address as the run would");
  const seen: { url: string; ua: string | null; accept: string | null }[] = [];
  let cancelled = false;
  const big = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes("%PDF-1.4 "));
      for (let i = 0; i < 100; i++) controller.enqueue(new Uint8Array(1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    seen.push({ url: String(url), ua: h.get("user-agent"), accept: h.get("accept") });
    return new Response(big, { status: 200, headers: { "content-type": "application/pdf" } });
  }) as typeof fetch;
  const v = await probeDocument("https://irp.cornell.edu/cds.pdf", fetchFn);
  assert.deepEqual(v, { outcome: "document", format: "pdf", detail: "a PDF" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].ua, USER_AGENT);
  assert.match(seen[0].accept ?? "", /application\/pdf/);
  assert.ok(cancelled, "the stream was cancelled after the head");

  const hang = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
    })) as typeof fetch;
  assert.deepEqual(await probeDocument("https://slow.example.edu/cds.pdf", hang, 20), { outcome: "error", detail: "no answer in time" });

  const refuse = (async () => new Response("<html><title>Just a moment...</title></html>", { status: 403 })) as typeof fetch;
  assert.deepEqual(await probeDocument("https://cf.example.edu/cds.pdf", refuse), { outcome: "blocked", detail: "a bot challenge" });

  let fetched = 0;
  const count = (async () => (fetched++, new Response("%PDF-1.4"))) as typeof fetch;
  for (const url of ["http://localhost:3000/x.pdf", "http://127.0.0.1/x.pdf", "http://10.1.2.3/x.pdf", "http://169.254.169.254/latest/meta-data", "http://192.168.1.1/x", "http://172.20.0.1/x", "http://[::1]/x", "http://[fe80::1]/x", "http://metadata.internal/x", "http://intranet/x.pdf", "ftp://ir.example.edu/x.pdf"]) {
    assert.deepEqual(await probeDocument(url, count), { outcome: "error", detail: "not a public address" }, url);
  }
  assert.equal(fetched, 0, "nothing private is fetched");
  assert.ok(isPublicAddress("https://irp.cornell.edu/cds.pdf"));
  assert.ok(isPublicAddress("http://8.8.8.8/x.pdf"));
  assert.ok(isPublicAddress("https://[2606:4700::6810:84e5]/x.pdf"));
  assert.ok(!isPublicAddress("not a url"));
});

/* ------------------------------------------------------------------ */
/* The assistant view                                                  */
/* ------------------------------------------------------------------ */

const login = (host: string, over: Partial<LoginDoc> = {}): LoginDoc => ({ host, account: "a counselor account", may_use: true, note: null, added: "2026-11-08", added_by: "Ray", ...over });

test("loginKey and loginFor: a host matches its login lowercase and without www.", () => {
  assert.equal(loginKey(" WWW.Portal.Example.EDU "), "portal.example.edu");
  const logins = new Map([["portal.example.edu", login("portal.example.edu")]]);
  assert.equal(loginFor({ host: "www.portal.example.edu" }, logins)?.account, "a counselor account");
  assert.equal(loginFor({ host: "other.example.edu" }, logins), null);
  assert.equal(loginFor({ host: null }, logins), null);
});

test("assistantRows: open rows only, never terms, a login only on a listed host, the batch capped, the order kept", () => {
  const logins = new Map([["portal.example.edu", login("portal.example.edu")]]);
  const rows: TodoDoc[] = [
    row({ key: "a", reach: 9 }),
    row({ key: "b", why: "terms", reach: 8 }),
    row({ key: "c", why: "login", host: "portal.example.edu", reach: 7 }),
    row({ key: "d", why: "login", host: "members.example.org", reach: 6 }),
    row({ key: "e", status: "found", document_url: "https://x.edu/cds.pdf", reach: 5 }),
    row({ key: "f", status: "no-document", reach: 4 }),
    row({ key: "g", why: "robots-host", reach: 3 }),
  ];
  assert.deepEqual(assistantRows(rows, logins).map((r) => r.key), ["a", "c", "g"]);
  assert.ok(!assistantCanWork(rows[3], logins), "a login on an unlisted host is a person's");
  assert.equal(assistantRows(rows, new Map()).length, 2, "no logins listed: the login row is left out");
  const many = Array.from({ length: ASSISTANT_BATCH + 5 }, (_, i) => row({ key: `k${i}` }));
  assert.equal(assistantRows(many, logins).length, ASSISTANT_BATCH);
  assert.equal(assistantRows(many, logins, 3).length, 3);
});

test("loginFromFields: a host name becomes a login document; anything else is refused", () => {
  const doc = loginFromFields({ host: "WWW.Portal.Example.edu", account: "  alumni login  ", may_use: false, note: null, at: "2026-11-08T10:00:00Z", by: "Ray" });
  assert.deepEqual(doc, { host: "portal.example.edu", account: "alumni login", may_use: false, note: null, added: "2026-11-08T10:00:00Z", added_by: "Ray" });
  assert.equal(loginFromFields({ host: "not a host", account: "x", may_use: true, note: null, at: "t", by: null }), null);
  assert.equal(loginFromFields({ host: "https://portal.example.edu/path", account: "x", may_use: true, note: null, at: "t", by: null }), null, "a URL is not a host");
  assert.equal(loginFromFields({ host: "localhost", account: "x", may_use: true, note: null, at: "t", by: null }), null, "one label is not a host");
});
