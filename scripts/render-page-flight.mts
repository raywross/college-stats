/**
 * A public page's RSC payload, rendered offline (round 5, U3; specs/serving-architecture.md "Round 5: the public pages'
 * payload"): renders a page module's default export (a college profile page or a compare page) for the bundled snapshot
 * (the mini fixture in a fresh checkout) through React's own Flight server, the serializer Next uses for a page's
 * payload, and prints its bytes, gzipped bytes, and what the payload still carries that it shouldn't (whole citations
 * in the ⓘ props: `"quote"` and `"method"` keys) as JSON. tests/public-payload.test.mts runs it as the payload guard;
 * scripts/measure-page-payload.mts measures a running server instead (HTML, inline scripts, per-prop ranking).
 *
 * Every "use client" module becomes a client reference (what the payload names, not what it runs); the server
 * components run for real. No database, no session; set SUPABASE_URL empty so the live-edit overlay reads nothing.
 *
 *   SUPABASE_URL= NODE_ENV=production node --conditions=react-server --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     scripts/render-page-flight.mts <page file, e.g. app/schools/[id]/page.tsx> [id=166027 | ids=a,b,c]
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import * as nodeModule from "node:module";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const require = createRequire(join(ROOT, "package.json"));
const NODE_MODULES = realpathSync(join(ROOT, "node_modules"));
const NEXT = join(NODE_MODULES, "next", "dist", "compiled");
const FLIGHT = join(NEXT, "react-server-dom-webpack", "cjs", "react-server-dom-webpack-server.node.production.js");

type ResolveResult = { url: string; shortCircuit?: boolean; format?: string };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(s: string, c: { parentURL?: string; conditions?: string[] }, n: (s: string, c?: unknown) => ResolveResult): ResolveResult;
    load(u: string, c: { format?: string }, n: (u: string, c?: unknown) => LoadResult): LoadResult;
  }): void;
};

/** React and React DOM as Next's server layer loads them (the react-server builds Next ships). */
const REACT: Record<string, string> = {
  react: join(NEXT, "react", "react.react-server.js"),
  "react/jsx-runtime": join(NEXT, "react", "jsx-runtime.react-server.js"),
  "react/jsx-dev-runtime": join(NEXT, "react", "jsx-dev-runtime.react-server.js"),
  "react-dom": join(NEXT, "react-dom", "react-dom.react-server.js"),
  "next/dist/compiled/react": join(NEXT, "react", "react.react-server.js"),
};

/** Modules that would reach the database, the session, or the request: none on a public page; stood in for anyway. */
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "@/lib/supabase-server": "export async function createServerSupabase(){ throw new Error('no database here'); } export function supabaseAuthEnv(){ return null; }",
  "@/lib/analytics-server": "export async function trackServer(){}",
  // Next's navigation module loads the client router; a page here only calls these two.
  "next/navigation": "export function notFound(){ throw new Error('not found'); } export function redirect(u){ throw new Error('redirect ' + u); }",
};
const STUB_URL = (name: string) => `file:///__measure_stubs__/${name.replace(/[^a-z]/gi, "_")}.mjs`;
const STUB_SOURCES = new Map(Object.entries(STUBS).map(([k, v]) => [STUB_URL(k), v]));

const asFile = (b: string) => [b, `${b}.ts`, `${b}.tsx`, join(b, "index.ts"), join(b, "index.tsx")].find((c) => existsSync(c) && /\.(m?[jt]sx?)$/.test(c)) ?? null;

/** The export names of a "use client" module (what a client reference stands for). */
function exportNames(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []) : [];
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isExportAssignment(st)) names.push("default");
    else if (exported && isDefault) names.push("default");
    else if (exported && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) names.push(st.name.text);
    else if (exported && ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) if (!e.isTypeOnly) names.push(e.name.text);
    }
  }
  return [...new Set(names)];
}

/** Whether the module's directive prologue (past any comments) holds "use client". */
function isClientModule(src: string): boolean {
  let i = 0;
  for (;;) {
    while (i < src.length && /[\s;]/.test(src[i])) i++;
    if (src.startsWith("/*", i)) i = src.indexOf("*/", i + 2) + 2;
    else if (src.startsWith("//", i)) i = src.indexOf("\n", i) + 1;
    else if (src.startsWith('"use client"', i) || src.startsWith("'use client'", i)) return true;
    else if (src[i] === '"' || src[i] === "'") i = src.indexOf(src[i], i + 1) + 1;
    else return false;
    if (i <= 1) return false;
  }
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: STUB_URL(specifier), shortCircuit: true, format: "module" };
    if (specifier in REACT) return { url: pathToFileURL(REACT[specifier]).href, shortCircuit: true };
    // next/link and next/image are client components as Next's bundler sees them: each a client reference here.
    if (specifier === "next/link" || specifier === "next/image") return { url: pathToFileURL(join(ROOT, `__measure_${specifier.slice(5)}__.tsx`)).href, shortCircuit: true };
    if (specifier === "lucide-react") return { url: pathToFileURL(join(NODE_MODULES, "lucide-react", "dist", "esm", "lucide-react.mjs")).href, shortCircuit: true };
    let b: string | null = null;
    if (specifier.startsWith("@/")) b = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !context.parentURL.includes("/node_modules/"))
      b = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = b ? asFile(b) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
    if (context.parentURL && STUB_SOURCES.has(context.parentURL)) return next(specifier, { ...context, parentURL: pathToFileURL(join(ROOT, "package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    const stub = STUB_SOURCES.get(url);
    if (stub) return { format: "module", source: stub, shortCircuit: true };
    const nextClient = /\/__measure_(link|image)__\.tsx$/.exec(url);
    if (nextClient) return { format: "module", source: clientRefModule(`next/${nextClient[1]}`, ["default"]), shortCircuit: true };
    // lucide-react's ESM build marks its Icon "use client", as Next's bundler sees it: an icon is a client reference.
    if (url.includes("/node_modules/lucide-react/") && url.endsWith(".mjs")) {
      const file = fileURLToPath(url);
      const src = readFileSync(file, "utf8");
      if (isClientModule(src)) return { format: "module", source: clientRefModule(file.slice(ROOT.length + 1), exportNames(file, src)), shortCircuit: true };
      return next(url, context);
    }
    if (url.startsWith("file:") && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
      const file = fileURLToPath(url);
      const src = readFileSync(file, "utf8");
      if (isClientModule(src)) return { format: "module", source: clientRefModule(file.slice(ROOT.length + 1), exportNames(file, src)), shortCircuit: true };
      // Node strips a .ts file's types itself; only JSX needs the compiler.
      if (file.endsWith(".ts")) return next(url, context);
      const { outputText } = ts.transpileModule(src, {
        fileName: file,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});


function clientRefModule(id: string, names: string[]): string {
  const lines = [`import { createRequire } from "node:module";`, `const F = createRequire(${JSON.stringify(join(ROOT, "package.json"))})(${JSON.stringify(FLIGHT)});`];
  const ref = (n: string) => `F.registerClientReference(function () { throw new Error("client only"); }, ${JSON.stringify(id)}, ${JSON.stringify(n)})`;
  for (const n of names) lines.push(n === "default" ? `export default ${ref(n)};` : `export const ${n} = ${ref(n)};`);
  return lines.join("\n");
}

const Flight = require(FLIGHT) as {
  renderToPipeableStream(model: unknown, config: unknown, opts?: { onError?: (e: unknown) => void }): { pipe(w: Writable): void };
};
/** Any client reference resolves to a module of its own (no chunks): what matters is the bytes the payload carries. */
const manifest = new Proxy({}, { get: (_t, key: string) => ({ id: key.split("#")[0], chunks: [], name: key.split("#")[1] ?? "*" }) });

async function flightBytes(element: unknown): Promise<{ raw: number; gz: number; text: string }> {
  const chunks: Buffer[] = [];
  await new Promise<void>((done, fail) => {
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
      final(cb) {
        cb();
        done();
      },
    });
    Flight.renderToPipeableStream(element, manifest, { onError: (e) => fail(e) }).pipe(sink);
  });
  const all = Buffer.concat(chunks);
  return { raw: all.length, gz: gzipSync(all).length, text: all.toString("utf8") };
}


const React = (await import("react")).default;
const [pageFile = "app/schools/[id]/page.tsx", arg = "166027"] = process.argv.slice(2);
const page = (await import(pathToFileURL(join(ROOT, pageFile)).href)) as { default: (props: unknown) => unknown };
// A profile page takes its id from params; a compare page its ids from searchParams.
const props = pageFile.includes("[id]") ? { params: Promise.resolve({ id: arg }) } : { searchParams: Promise.resolve({ ids: arg }) };
const element = React.createElement(page.default as never, props as never);
const { raw, gz, text } = await flightBytes(element);
const count = (re: RegExp) => (text.match(re) ?? []).length;
console.log(JSON.stringify({ page: pageFile, arg, bytes: raw, gzipped: gz, quoteKeys: count(/"quote":/g), methodKeys: count(/"method":/g), refs: count(/"ref":true/g), text: process.env.PRINT_FLIGHT ? text : undefined }));
