/**
 * The Data API's pages (specs/product/data-api.md "Pages"; app/developers/page.tsx, app/account/api-keys/**,
 * components/api/**, components/account/api-keys/**): the pure parts (connection snippets with an origin and a key, the
 * usage line, the key limit, the terms) and static checks on the source, since pages and components can't render under
 * node:test. The developers page must generate its endpoint table, tool table, field registry, and limits from the code
 * that serves them (lib/api/routes.ts, lib/api/serialize.ts, lib/api/keys.ts), never from a typed copy; neither page
 * names a data year; the footer and the Data page link to /developers; nothing reaches the method (lib/selectivity.ts,
 * lib/chances/*, lib/admin/*). Each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { API_KEY_LIMITS, API_KEY_NAME_MAX } from "../lib/api/keys.ts";
import { API_BASE, MCP_PATH } from "../lib/api/routes.ts";
import { DOCS_ORIGIN, EXAMPLE_UNIT_ID, KEY_PLACEHOLDER, canMakeKey, cleanOrigin, connectionSnippets, keyDate, usageLine } from "../lib/api-snippets.ts";
import { API_TERMS, TERMS_LINE, attributionLine } from "../lib/api-terms.ts";
import { TOPIC_LABELS } from "../lib/topic-labels.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Code with comments removed, so documentation doesn't trip the guards (same stripping as tests/citation-guards.test.mts). */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|mts)$/.test(name) ? [p] : [];
  });
}

const DEVELOPERS_PAGE = "app/developers/page.tsx";
const PAGE_FILES = [
  ...sourceFiles("app/developers"),
  ...sourceFiles("app/account/api-keys"),
  ...sourceFiles("components/api"),
  ...sourceFiles("components/account/api-keys"),
  "lib/api-snippets.ts",
  "lib/api-terms.ts",
];

/** The same pattern tests/citation-guards.test.mts uses: "Fall 2024", "2023–24". */
const YEAR = /\b[Ff]all 20\d\d\b|\b20\d\d[–-]\d\d\b/;

/** Lines of `source` (comments stripped) that match `pattern`. */
const hits = (source: string, pattern: RegExp) =>
  code(source)
    .split("\n")
    .filter((line) => pattern.test(line));

/* ------------------------------------------------------------------ */
/* Snippets                                                            */
/* ------------------------------------------------------------------ */

const KEY = "quad_abcdefghijklmnopqrstuvwxyz234567abcdefgh";

test("curl snippet sends the key as a bearer token to one college", () => {
  const { curl } = connectionSnippets("https://example.test", KEY);
  assert.equal(curl, `curl -H "Authorization: Bearer ${KEY}" https://example.test${API_BASE}/schools/${EXAMPLE_UNIT_ID}`);
});

test("Claude Code snippet adds an http MCP server with the header", () => {
  const { claudeCode } = connectionSnippets("https://example.test", KEY);
  assert.equal(claudeCode, `claude mcp add --transport http quad https://example.test${MCP_PATH} --header "Authorization: Bearer ${KEY}"`);
});

test("mcpServers snippet is valid JSON that runs mcp-remote with the header", () => {
  const { mcpJson } = connectionSnippets("https://example.test", KEY);
  const parsed = JSON.parse(mcpJson);
  assert.deepEqual(parsed, {
    mcpServers: {
      quad: { command: "npx", args: ["-y", "mcp-remote", `https://example.test${MCP_PATH}`, "--header", `Authorization:Bearer ${KEY}`] },
    },
  });
});

test("snippets use the origin as given, without a doubled slash, and the placeholder on /developers", () => {
  assert.equal(cleanOrigin("http://localhost:3000///"), "http://localhost:3000");
  const s = connectionSnippets("http://localhost:3000/", KEY);
  assert.ok(s.curl.includes(`http://localhost:3000${API_BASE}/`));
  assert.ok(!s.curl.includes("//api"));
  const generic = connectionSnippets(DOCS_ORIGIN, KEY_PLACEHOLDER);
  for (const text of Object.values(generic)) assert.ok(text.includes(KEY_PLACEHOLDER) && !text.includes(KEY));
  assert.ok(KEY_PLACEHOLDER.startsWith("quad_"));
});

/* ------------------------------------------------------------------ */
/* Formatters, limits, terms                                           */
/* ------------------------------------------------------------------ */

test("usage line reads against the daily limit from API_KEY_LIMITS", () => {
  assert.equal(usageLine(12), `12 of ${API_KEY_LIMITS.perDay.toLocaleString("en-US")}`);
  assert.equal(usageLine(1234.4, 5000), "1,234 of 5,000");
});

test("a key can be made only below the per-account limit", () => {
  assert.equal(canMakeKey(0), true);
  assert.equal(canMakeKey(API_KEY_LIMITS.keysPerUser - 1), true);
  assert.equal(canMakeKey(API_KEY_LIMITS.keysPerUser), false);
});

test("key dates print the UTC day", () => {
  assert.equal(keyDate("2026-10-20T23:59:00Z"), "Oct 20, 2026");
  assert.equal(keyDate("2026-10-20T00:01:00Z"), "Oct 20, 2026");
});

test("the terms line and list cover attribution, no reselling, no lead generation, and personal keys", () => {
  assert.match(TERMS_LINE, /^By making a key you agree/);
  for (const word of [/credit/i, /resell/i, /leads/i, /keep your key/i]) assert.match(TERMS_LINE, word);
  const text = API_TERMS.map((t) => `${t.title} ${t.body}`).join(" ");
  for (const word of [/attribution/i, /resell/i, /lead generation/i, /personal/i, /Common Data Set/]) assert.match(text, word);
  assert.equal(attributionLine("Oct 20, 2026"), "Data: Quad, from College Scorecard and IPEDS, Oct 20, 2026");
  assert.equal(attributionLine(), "Data: Quad, from College Scorecard and IPEDS");
});

test("every topic has a label (the field registry is grouped by them)", () => {
  assert.equal(Object.keys(TOPIC_LABELS).length, 10);
  for (const label of Object.values(TOPIC_LABELS)) assert.ok(label.length > 0);
  assert.ok(API_KEY_NAME_MAX > 0);
});

/* ------------------------------------------------------------------ */
/* /developers is generated from code                                  */
/* ------------------------------------------------------------------ */

test("the developers page reads the route table, the tool table, the field registry, and the limits", () => {
  const page = code(read(DEVELOPERS_PAGE));
  for (const name of ["API_ROUTES", "MCP_TOOLS", "fieldRegistry", "API_KEY_LIMITS"]) {
    assert.match(page, new RegExp(`\\b${name}\\b`), `${name} isn't used on ${DEVELOPERS_PAGE}`);
  }
  // It maps over the tables rather than naming rows.
  assert.match(page, /API_ROUTES\.map\(/);
  assert.match(page, /MCP_TOOLS\.map\(/);
  assert.match(page, /fieldRegistry\(/);
});

test("the developers page types no endpoint path and no limit number of its own", () => {
  const page = read(DEVELOPERS_PAGE);
  assert.deepEqual(hits(page, /\/api\/(v\d|mcp)/), [], "a literal API path (use API_BASE, MCP_PATH, or API_ROUTES)");
  assert.deepEqual(hits(page, /\b5,?000\b|\b60 (requests|a minute)\b/), [], "a literal limit (use API_KEY_LIMITS)");
});

test("the keys page and its form read the limits from API_KEY_LIMITS", () => {
  for (const file of ["app/account/api-keys/page.tsx", "components/account/api-keys/MakeKeyForm.tsx"]) {
    assert.match(code(read(file)), /\bAPI_KEY_LIMITS\b/, `${file} doesn't read API_KEY_LIMITS`);
    assert.deepEqual(hits(read(file), /\b5,?000\b/), [], `${file} types the daily limit`);
  }
  // Paths in the snippets come from the route table's constants.
  const snippets = code(read("lib/api-snippets.ts"));
  assert.match(snippets, /\bAPI_BASE\b/);
  assert.match(snippets, /\bMCP_PATH\b/);
  assert.deepEqual(hits(read("lib/api-snippets.ts"), /\/api\/(v\d|mcp)/), []);
});

test("the keys page validates names with normalizeKeyName and is not indexed", () => {
  assert.match(code(read("app/account/api-keys/actions.ts")), /\bnormalizeKeyName\(/);
  assert.match(read("app/account/api-keys/page.tsx"), /robots:\s*\{\s*index:\s*false\s*\}/);
  assert.match(code(read("app/account/api-keys/page.tsx")), /\bApiKeysSetupError\b/);
});

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

test("the footer and the Data page link to /developers; the account page links to the keys page", () => {
  assert.match(read("components/layout/Footer.tsx"), /href="\/developers"[^>]*>Developers: API and MCP</);
  assert.match(read("app/data/page.tsx"), /href="\/developers"/);
  const account = read("app/account/page.tsx");
  assert.match(account, /id="api-keys"/);
  assert.match(account, /href="\/account\/api-keys"/);
  assert.ok(account.indexOf('id="data"') < account.indexOf('id="api-keys"') && account.indexOf('id="api-keys"') < account.indexOf('id="delete"'), "section order");
});

/* ------------------------------------------------------------------ */
/* Years, and the method                                               */
/* ------------------------------------------------------------------ */

test("neither page names a data year (years come from lineage)", () => {
  assert.ok(PAGE_FILES.length >= 8, `found ${PAGE_FILES.length} page files`);
  for (const file of PAGE_FILES) assert.deepEqual(hits(read(file), YEAR), [], file);
});

test("nothing on these pages imports the method (lib/selectivity.ts, lib/chances/*, lib/admin/*)", () => {
  const banned = /from\s+["'](?:@\/|(?:\.\.?\/)+)(?:lib\/)?(?:selectivity|chances\/(?!rate-limit)|admin\/)/;
  for (const file of PAGE_FILES) assert.deepEqual(hits(read(file), banned), [], file);
});

test("the guards fail when their rule is broken", () => {
  assert.ok(YEAR.test("Fall 2024") && YEAR.test("data for 2023–24"));
  assert.ok(!YEAR.test("retrieved Oct 20, 2026"));
  assert.equal(hits('<a href="/api/v1/schools">', /\/api\/(v\d|mcp)/).length, 1);
  assert.equal(hits("// see /api/v1/schools\nconst x = API_BASE;", /\/api\/(v\d|mcp)/).length, 0);
  assert.equal(hits('import { x } from "@/lib/selectivity";', /from\s+["']@\/(?:lib\/)?selectivity/).length, 1);
  assert.match(relative(ROOT, join(ROOT, DEVELOPERS_PAGE)), /developers/);
});
