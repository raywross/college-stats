/**
 * The public pages' payload (round 5, U3; specs/serving-architecture.md "Round 5: the public pages' payload"): fetches
 * each page from a running server (signed out), prints its HTML size, its inline scripts' size (the inline RSC), the
 * Flight stream's size, and the ten largest client-component props by serialized size, naming the component and the
 * prop (scripts/lib/page-payload.mts does the splitting). Against a production build (`next build && next start`) it
 * names each client module by its file, from `.next`'s client-reference manifests; against `next dev` the ids are the
 * files already.
 *
 *   BASE=http://localhost:3000 node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/measure-page-payload.mts \
 *     [--top 10] [--save <dir>] [--diff <dir>] [path …]
 *
 * With no paths it measures the default set: the Harvard and Ohio State profiles (overview, admissions, cost)
 * and the compare overview and admissions for UCLA, Harvard, and Ohio State (the brief's set). `--save <dir>` writes each page's HTML, text, and markup
 * (scripts stripped, asset paths normalized) to the folder; `--diff <dir>` compares this run's text and markup with a
 * saved run's and exits 1 when any page differs (the text-identity check).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { measurePayload, pageMarkup, pageText } from "./lib/page-payload.mts";

const ROOT = join(import.meta.dirname, "..");
const BASE = process.env.BASE ?? "http://localhost:3000";
const COMPARE_IDS = "110662,166027,204796".split(",");

export const DEFAULT_PATHS = [
  "/schools/166027",
  "/schools/166027/admissions",
  "/schools/166027/cost",
  "/schools/204796",
  "/schools/204796/admissions",
  "/schools/204796/cost",
  `/compare?ids=${COMPARE_IDS.join(",")}`,
  `/compare/admissions?ids=${COMPARE_IDS.join(",")}`,
];

const args = process.argv.slice(2);
let top = 10;
let saveDir: string | null = null;
let diffDir: string | null = null;
const paths: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--top") top = Number(args[++i]);
  else if (args[i] === "--save") saveDir = args[++i];
  else if (args[i] === "--diff") diffDir = args[++i];
  else paths.push(args[i]);
}

/** Module id → repository file, from every client-reference manifest under `.next/server/app`. */
function moduleNames(): Map<string, string> {
  const out = new Map<string, string>();
  const dir = join(ROOT, ".next", "server", "app");
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith("_client-reference-manifest.js")) {
        const src = readFileSync(p, "utf8");
        const m = /=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(src);
        if (!m) continue;
        try {
          const manifest = JSON.parse(m[1]) as { clientModules?: Record<string, { id: string | number }> };
          for (const [file, entry] of Object.entries(manifest.clientModules ?? {})) {
            const rel = file.split("#")[0].replace(ROOT + "/", "").replace(/^.*\/node_modules\//, "node_modules/");
            if (!out.has(String(entry.id))) out.set(String(entry.id), rel);
          }
        } catch {
          /* a manifest this script can't read: ids stay numbers */
        }
      }
    }
  };
  walk(dir);
  return out;
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const slug = (p: string) => p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "home";

const names = moduleNames();
let differs = 0;
for (const path of paths.length ? paths : DEFAULT_PATHS) {
  const res = await fetch(BASE + path, { headers: { "user-agent": "measure-page-payload" } });
  const html = await res.text();
  const m = measurePayload(html, names);
  console.log(`\n## ${path} (${res.status})`);
  console.log(`HTML ${kb(m.htmlBytes)} · inline scripts ${kb(m.inlineScriptBytes)} · Flight ${kb(m.flightBytes)} (${m.rows} rows) · client props ${kb(m.clientPropBytes)} · server SVG ${kb(m.svgBytes)} · classNames ${kb(m.classNameBytes)}`);
  console.log(`| # | Component | Prop | Elements | Bytes |\n|---|---|---|---|---|`);
  m.props.slice(0, top).forEach((p, i) => console.log(`| ${i + 1} | ${p.component} | \`${p.prop}\` | ${p.count} | ${p.bytes.toLocaleString()} |`));
  console.log(`Components by props (children excluded): ${m.components.slice(0, 8).map((c) => `${c.component.replace(/^.*\//, "")} ×${c.elements} ${kb(c.bytes)}`).join("; ")}`);
  const text = pageText(html);
  const markup = pageMarkup(html);
  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    writeFileSync(join(saveDir, `${slug(path)}.html`), html);
    writeFileSync(join(saveDir, `${slug(path)}.txt`), text);
    writeFileSync(join(saveDir, `${slug(path)}.markup.html`), markup);
  }
  if (diffDir) {
    const before = (ext: string) => {
      const f = join(diffDir!, `${slug(path)}${ext}`);
      return existsSync(f) ? readFileSync(f, "utf8") : null;
    };
    const t = before(".txt");
    const k = before(".markup.html");
    const ok = t === text && k === markup;
    if (!ok) differs++;
    console.log(`Identity with ${diffDir}: text ${t === text ? "same" : "DIFFERENT"}, markup ${k === markup ? "same" : "DIFFERENT"}`);
  }
}
if (diffDir && differs) process.exit(1);
