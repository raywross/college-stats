/**
 * The public pages' payload (round 5, U3; specs/serving-architecture.md "Round 5: the public pages' payload"):
 * - scripts/lib/page-payload.mts, the measurement: Flight rows rebuilt from the pushes, each client element's props
 *   ranked by size (an outlined row counted, a dedup path reference not), the page text the identity check compares,
 *   and `fullCitationPaths`, which finds a whole citation in a payload;
 * - the payload guard: the mini fixture's Harvard overview, rendered offline through Flight
 *   (scripts/render-page-flight.mts), stays under a ceiling, and the compare overview too; no whole citation reaches
 *   a client component on them except the kinds kept on purpose (a GPA field: the API answers with the model's formula;
 *   a hero link's SourcesTip group);
 * - the text-identity check for what moved to the client: SourceItem and SourceListItems render the same markup the
 *   server rendered before (the pre-round-5 JSX is copied below as the reference), and an ⓘ renders the same markup
 *   from a reference as from the whole citation.
 * The pages' full HTML before and after was compared with `scripts/measure-page-payload.mts --save/--diff` against a
 * production build (the report's tables); this file keeps the parts that can run without one. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { flightOf, fullCitationPaths, measurePayload, pageText, parseRows } from "../scripts/lib/page-payload.mts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

/* ------------------------------------------------------------------ */
/* scripts/lib/page-payload.mts                                        */
/* ------------------------------------------------------------------ */

/** A page as Next writes it: the Flight stream split across `self.__next_f.push` scripts. */
function pageOf(flight: string, body = "<p>Hello</p>"): string {
  const half = Math.floor(flight.length / 2);
  const push = (s: string) => `<script>self.__next_f.push(${JSON.stringify([1, s])})</script>`;
  return `<!DOCTYPE html><html><body>${body}<script src="/_next/a.js"></script><script>(self.__next_f=self.__next_f||[]).push([0])</script>${push(flight.slice(0, half))}${push(flight.slice(half))}</body></html>`;
}

const BIG = { key: "cds", label: "Some College Common Data Set 2025–26", url: "https://example.edu/cds.pdf", quote: "x".repeat(400) };
// A text row is length-prefixed in UTF-8 bytes ("héllo" is 6) and the next row follows it with no newline.
const FLIGHT = [
  `1:I["mod-a",[],"MetricLabel"]`,
  `2:{"rows":[1,2,3]}`,
  `3:T6,héllo0:["$","div",null,{"className":"p-4","children":[["$","$L1",null,{"term":"t","cited":${JSON.stringify(BIG)},"children":"Rate"}],["$","$L1",null,{"cited":"$0:props:children:0:props:cited"}],["$","$L1",null,{"data":"$2","text":"$3"}]]}]`,
  "",
].join("\n");

test("parseRows: model rows, client references, and length-prefixed text rows (UTF-8 lengths)", () => {
  const rows = parseRows(flightOf(pageOf(FLIGHT)));
  assert.deepEqual(rows.map((r) => [r.id, r.tag]), [["1", "I"], ["2", ""], ["3", "T"], ["0", ""]]);
  assert.equal(rows[2].text, "héllo");
  assert.deepEqual(rows[1].json, { rows: [1, 2, 3] });
});

test("measurePayload: props ranked by component and prop; outlined rows counted, dedup references not; children excluded", () => {
  const m = measurePayload(pageOf(FLIGHT), new Map([["mod-a", "components/ui/info-tip-client.tsx"]]));
  const top = m.props[0];
  assert.equal(top.component, "MetricLabel (components/ui/info-tip-client.tsx)");
  assert.equal(top.prop, "cited");
  assert.equal(top.count, 2, "two elements carry `cited`");
  assert.equal(top.bytes, Buffer.byteLength(JSON.stringify(BIG)) + Buffer.byteLength(JSON.stringify("$0:props:children:0:props:cited")), "the dedup reference costs only its own bytes");
  const data = m.props.find((p) => p.prop === "data")!;
  assert.equal(data.bytes, Buffer.byteLength('"$2"') + Buffer.byteLength('{"rows":[1,2,3]}'), "an outlined row counts toward the prop");
  assert.equal(m.props.some((p) => p.prop === "children"), false);
  assert.equal(m.components[0].elements, 3);
  assert.ok(m.inlineScriptBytes > m.flightBytes, "the inline scripts are the escaped stream plus the bootstrap");
  assert.equal(pageText(pageOf(FLIGHT, "<h1>Title &amp; more</h1><script>ignored()</script><p> a  b </p>")), "Title & more\na b");
});

test("fullCitationPaths finds a whole citation in a payload and ignores references (the guard's own check)", () => {
  const full = JSON.stringify({ path: "admissions.acceptance_rate", field: "Acceptance rate", method: "reported", url: "u" });
  const ref = JSON.stringify({ ref: true, unit: "166027", path: "admissions.acceptance_rate", key: "cds", year: "2025" });
  assert.deepEqual(fullCitationPaths(`0:["$","$L1",null,{"cited":${full}}]`), ["admissions.acceptance_rate"]);
  assert.deepEqual(fullCitationPaths(`0:["$","$L1",null,{"cited":${ref}}]`), []);
});

/* ------------------------------------------------------------------ */
/* The payload guard                                                   */
/* ------------------------------------------------------------------ */

type Rendered = { bytes: number; gzipped: number; refs: number; text: string };
function render(page: string, arg: string): Rendered {
  const out = execFileSync(
    process.execPath,
    ["--conditions=react-server", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "render-page-flight.mts"), page, arg],
    { cwd: ROOT, env: { ...process.env, NODE_ENV: "production", SUPABASE_URL: "", PRINT_FLIGHT: "1" }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  return JSON.parse(out.trim().split("\n").at(-1)!) as Rendered;
}

const GPA = new Set(["reported.admission_profile.gpa.average", "derived.gpa_band_mean", "derived.gpa_middle_half", "derived.gpa_estimate"]);
/** Kept whole on purpose: a GPA field, and the hero's SourcesTip groups (one popover listing several sources). */
const keptWhole = (path: string) => GPA.has(path) || /^(links|social)\./.test(path);

// Measured 2026-11-08 on the mini fixture (offline Flight, no layout): Harvard's overview 86.5 KB after round 5
// (the same render before round 5 carried every ⓘ's whole citation and the source list's markup). A ceiling with
// about a tenth of headroom: a page that starts shipping whole citations or school objects again crosses it.
const HARVARD_OVERVIEW_CEILING = 95_000;
const COMPARE_OVERVIEW_CEILING = 82_000;

test("payload guard: Harvard's overview stays under its ceiling, its ⓘ citations references", () => {
  const r = render("app/schools/[id]/page.tsx", "166027");
  console.log(`[public-payload] Harvard overview: ${r.bytes} bytes (${r.gzipped} gzipped), ${r.refs} references`);
  assert.ok(r.bytes < HARVARD_OVERVIEW_CEILING, `${r.bytes} bytes is over the ceiling ${HARVARD_OVERVIEW_CEILING}`);
  assert.ok(r.refs > 20, `${r.refs} references`);
  assert.deepEqual(fullCitationPaths(r.text).filter((p) => !keptWhole(p)), [], "no whole citation but the kept kinds");
});

test("payload guard: the compare overview stays under its ceiling with no whole citation; compare admissions only GPA fields", () => {
  const ids = "110662,166027,204796";
  const overview = render("app/compare/page.tsx", ids);
  console.log(`[public-payload] compare overview: ${overview.bytes} bytes (${overview.gzipped} gzipped)`);
  assert.ok(overview.bytes < COMPARE_OVERVIEW_CEILING, `${overview.bytes} bytes is over the ceiling ${COMPARE_OVERVIEW_CEILING}`);
  assert.deepEqual(fullCitationPaths(overview.text), []);
  const admissions = render("app/compare/admissions/page.tsx", ids);
  console.log(`[public-payload] compare admissions: ${admissions.bytes} bytes (${admissions.gzipped} gzipped)`);
  assert.deepEqual(fullCitationPaths(admissions.text).filter((p) => !GPA.has(p)), []);
  // The pool colleges carry only the lineage the pool reads (four paths), never a college's whole lineage.
  assert.doesNotMatch(admissions.text, /"lineage":\{[^}]*"admissions\.sat_/);
});

/* ------------------------------------------------------------------ */
/* Text identity for what moved to the client                          */
/* ------------------------------------------------------------------ */

const req = createRequire(join(ROOT, "package.json"));
const tmp = mkdtempSync(join(tmpdir(), "public-payload-"));
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(pathToFileURL(req.resolve("react")).href)};\nexport default ({ href, children, prefetch: _p, ...rest }) => React.createElement("a", { href, ...rest }, children);`);
const BARE: Record<string, string> = {
  react: pathToFileURL(req.resolve("react")).href,
  "lucide-react": pathToFileURL(join(ROOT, "node_modules", "lucide-react", "dist", "esm", "lucide-react.mjs")).href,
  "@base-ui/react/popover": pathToFileURL(req.resolve("@base-ui/react/popover")).href,
  "next/link": pathToFileURL(join(tmp, "link.mjs")).href,
};

/** Transpiles TSX (a file or a source string) to a module in a temp folder and imports it. */
async function load(src: string, name: string): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(src, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  let code = outputText.replace(/from "([^"]+)"/g, (m, spec: string) => {
    if (spec in BARE) return `from ${JSON.stringify(BARE[spec])}`;
    if (spec === "react/jsx-runtime") return `from ${JSON.stringify(pathToFileURL(req.resolve("react/jsx-runtime")).href)}`;
    if (spec.startsWith("@/")) return `from ${JSON.stringify(pathToFileURL(join(ROOT, spec.slice(2))).href)}`;
    if (spec.startsWith("./")) return `from ${JSON.stringify(pathToFileURL(join(ROOT, "components", name.split("/")[0], spec.slice(2))).href)}`;
    return m;
  });
  code = code.replace(/^"use client";\s*/, "");
  const file = join(tmp, `${name.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, code);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

// The rows as SourceNote.tsx's SourceItem and SourceList drew them on the server before round 5, word for word.
const BEFORE = `
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { citesYear, isEditedSource, yearLabel } from "@/lib/lineage";
export function SourceItem({ s, last }) {
  if (isEditedSource(s)) {
    return (
      <span>
        <Link href="/data#edits" className="font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary">
          Edited by Quad
        </Link>
        {last ? "" : ";"}
      </span>
    );
  }
  return (
    <span>
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-primary"
      >
        {s.label}
        <ExternalLink className="size-2.5" aria-hidden />
      </a>
      {citesYear(s) && \`, \${yearLabel(s)}\`}
      {last ? "" : ";"}
    </span>
  );
}
export function List({ sources }) {
  return (
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {sources.map((s, i) => (
          <li key={\`\${s.key}\${s.url}\`} className="flex gap-3 rounded-2xl border bg-card p-4 text-sm">
            <span className="font-display font-bold text-muted-foreground tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-primary">
                {s.label} <ExternalLink className="size-3" aria-hidden />
              </a>
              <p className="text-xs text-muted-foreground">
                {s.publisher} · {s.years.join("; ")} · retrieved {s.retrieved}
              </p>
            </div>
          </li>
        ))}
      </ol>
  );
}`;

const SOURCES = [
  { key: "ipeds-adm", label: "IPEDS Admissions survey", publisher: "NCES", url: "https://nces.ed.gov/adm.zip", year: "Fall 2024", retrieved: "2026-10-12", years: ["Fall 2024", "Fall 2023"] },
  { key: "wikidata", label: "Wikidata", publisher: "Wikimedia", url: "https://www.wikidata.org/", year: null, retrieved: "2026-10-12", years: ["most recent release"] },
  { key: "quad-edit", label: "Quad's editors", publisher: "Quad", url: "https://usequad.app/data", year: null, retrieved: "2026-11-01", years: ["most recent release"] },
];

test("text identity: SourceItem and SourceListItems render the markup the server rendered before", async () => {
  const before = await load(BEFORE, "sources/before");
  const item = await load(read("components/sources/SourceItem.tsx"), "sources/SourceItem");
  const list = await load(read("components/sources/SourceListItems.tsx"), "sources/SourceListItems");
  for (const [i, s] of SOURCES.entries())
    for (const last of [true, false]) {
      const old = renderToStaticMarkup(createElement(before.SourceItem as never, { s, last } as never));
      const now = renderToStaticMarkup(createElement(item.SourceItem as never, { s: { key: s.key, label: s.label, url: s.url, year: s.year }, last } as never));
      assert.equal(now, old, `source ${i}, last=${last}`);
    }
  const rows = SOURCES.filter((s) => s.key !== "quad-edit");
  const old = renderToStaticMarkup(createElement(before.List as never, { sources: rows } as never));
  const now = renderToStaticMarkup(
    createElement(list.SourceListItems as never, { sources: rows.map((s) => ({ id: `${s.key}${s.url}`, label: s.label, url: s.url, publisher: s.publisher, years: s.years.join("; "), retrieved: s.retrieved })) } as never),
  );
  assert.equal(now, old);
  // Guard: a changed row (another class) is caught.
  assert.notEqual(now.replace("rounded-2xl", "rounded-xl"), old);
});

test("text identity: an ⓘ renders the same markup from a reference as from the whole citation", async () => {
  const tip = await load(read("components/ui/info-tip-client.tsx"), "ui/info-tip-client");
  const full = {
    key: "ipeds-adm", label: "IPEDS Admissions survey", publisher: "NCES", year: "Fall 2024", url: "https://nces.ed.gov/adm.zip", retrieved: "2026-10-12",
    path: "admissions.acceptance_rate", field: "Acceptance rate", method: "reported", isDefault: true,
  };
  const ref = { ref: true, unit: "166027", path: "admissions.acceptance_rate", key: "ipeds-adm", year: "Fall 2024" };
  for (const [name, props] of [
    ["MetricLabel", { term: "acceptance-rate", children: "Acceptance rate" }],
    ["MetricLabel", { children: "Acceptance rate" }],
    ["InfoTip", { term: "acceptance-rate" }],
    ["SourceTip", {}],
    ["Term", { term: "acceptance-rate", children: "admit rate" }],
  ] as const) {
    const a = renderToStaticMarkup(createElement(tip[name] as never, { ...props, cited: full } as never));
    const b = renderToStaticMarkup(createElement(tip[name] as never, { ...props, cited: ref } as never));
    assert.equal(b, a, name);
    assert.ok(a.length > 20, `${name} rendered`);
  }
});
