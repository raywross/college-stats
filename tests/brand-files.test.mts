/**
 * The committed brand files agree with each other and with the dataset (specs/school-identity/brand.md, Checks):
 * every mark has its WebP and every WebP a mark and a school; a `logo: false` removal leaves no file behind; every
 * color row names a school; every override is well formed; and the real files give every school valid lineage.
 * `npm test` (so `npm run verify` and CI run it).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { DatasetMeta, School } from "../lib/types";
import type { BrandColorEntry, BrandLogoEntry, BrandOverride } from "../lib/identity-files";
import { applyBrand, normalizeHex, overrideProblems } from "../lib/brand-colors.ts";
import { validateSchool } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const read = <T,>(rel: string, fallback: T): T => (existsSync(join(ROOT, rel)) ? (JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T) : fallback);
const schools: School[] = read("data/schools.json", []);
const meta: DatasetMeta = read("data/meta.json", {} as DatasetMeta);
const ids = new Set(schools.map((s) => s.unit_id));
const colors: BrandColorEntry[] = read("data/brand-colors.json", []);
const logos: BrandLogoEntry[] = read("data/brand-logos.json", []);
const overrides: Record<string, BrandOverride> = read("data/brand-overrides.json", {});
const BRAND_DIR = join(ROOT, "public", "brand");
const files = existsSync(BRAND_DIR) ? readdirSync(BRAND_DIR).filter((f) => !f.startsWith(".")) : [];
const removed = Object.entries(overrides).filter(([id, o]) => !id.startsWith("_") && o.logo === false).map(([id]) => id);

test("every mark has its WebP, 192 px square, and every file in public/brand/ is a mark of a known school", async () => {
  const logoIds = new Set(logos.map((l) => l.unit_id));
  assert.equal(logoIds.size, logos.length, "one row per college in data/brand-logos.json");
  for (const l of logos) {
    assert.ok(ids.has(l.unit_id), `data/brand-logos.json: ${l.unit_id} isn't a school`);
    const file = join(BRAND_DIR, `${l.unit_id}.webp`);
    assert.ok(existsSync(file), `${l.unit_id}: public/brand/${l.unit_id}.webp is missing`);
    assert.ok(/^https?:\/\//.test(l.source_url) && /^\d{4}-\d\d-\d\d$/.test(l.retrieved) && l.width === 192, `${l.unit_id}: malformed row`);
  }
  for (const f of files) {
    const id = f.replace(/\.webp$/, "");
    assert.match(f, /^\d+\.webp$/, `public/brand/${f}: only {unit_id}.webp files belong here`);
    assert.ok(logoIds.has(id), `public/brand/${f} has no row in data/brand-logos.json`);
    assert.ok(ids.has(id), `public/brand/${f} isn't a school`);
    assert.ok(statSync(join(BRAND_DIR, f)).size < 64 * 1024, `public/brand/${f} is over 64 KB`);
  }
  const sizes = await Promise.all(files.map((f) => sharp(join(BRAND_DIR, f)).metadata()));
  sizes.forEach((m, k) => assert.ok(m.format === "webp" && m.width === 192 && m.height === 192, `public/brand/${files[k]}: ${m.format} ${m.width}×${m.height}`));
});

test("every school's brand.logo in the dataset has its file", () => {
  for (const s of schools) {
    if (!s.brand?.logo) continue;
    assert.ok(existsSync(join(BRAND_DIR, `${s.unit_id}.webp`)), `${s.name}: brand.logo without public/brand/${s.unit_id}.webp`);
  }
});

test("a logo: false removal leaves no file, no row, and no mark in the dataset", () => {
  for (const id of removed) {
    assert.equal(existsSync(join(BRAND_DIR, `${id}.webp`)), false, `${id} asked for removal but public/brand/${id}.webp exists`);
    assert.ok(!logos.some((l) => l.unit_id === id), `${id} asked for removal but data/brand-logos.json lists it`);
    assert.equal(schools.find((s) => s.unit_id === id)?.brand?.logo ?? null, null, `${id} asked for removal but data/schools.json shows a mark`);
  }
});

test("color rows and overrides are well formed and name real schools", () => {
  assert.equal(new Set(colors.map((c) => c.unit_id)).size, colors.length, "one row per college in data/brand-colors.json");
  for (const c of colors) {
    assert.ok(ids.has(c.unit_id), `data/brand-colors.json: ${c.unit_id} isn't a school`);
    assert.ok(c.colors.length > 0 && c.colors.every((h) => normalizeHex(h) === h), `${c.unit_id}: colors must be "#RRGGBB"`);
    assert.ok(!c.names || c.names.length === c.colors.length, `${c.unit_id}: one name (or null) per color`);
    assert.ok(c.key !== null || c.via === "infobox", `${c.unit_id}: colors without a module key come from the infobox`);
  }
  for (const [id, o] of Object.entries(overrides)) {
    if (id.startsWith("_")) continue; // _readme and other notes
    assert.ok(ids.has(id), `data/brand-overrides.json: ${id} isn't a school`);
    assert.deepEqual(overrideProblems(id, o), []);
  }
});

/** Every .tsx under app/ and components/, as [path, source]. */
function uiSources(): [string, string][] {
  const walk = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith(".tsx") ? [join(dir, d.name)] : []));
  return [...walk("app"), ...walk("components")].map((p) => [p, readFileSync(join(ROOT, p), "utf8")]);
}

test("every <Crest> passes brand, so no view is left with the generated tile by accident", () => {
  const missing: string[] = [];
  for (const [path, src] of uiSources()) {
    for (const m of src.matchAll(/<Crest\b[^>]*?\/>/g)) if (!/\bbrand=/.test(m[0])) missing.push(`${path}: ${m[0].slice(0, 80)}`);
  }
  assert.deepEqual(missing, [], "pass brand={crestBrand(school)} on the server, or the brand the client's data carries");
});

test("charts never use a college's colors (the compare slot palette is validated for contrast)", () => {
  for (const [path, src] of uiSources()) {
    if (!path.startsWith(join("components", "charts"))) continue;
    assert.doesNotMatch(src, /\.(accent|on_accent|tint_light|tint_dark|crest_to|gradient)\b|brandTint|crestTint/, `${path} reads a college's colors`);
  }
});

test("the committed brand files give every school valid lineage", () => {
  const byId = <T extends { unit_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.unit_id, r]));
  const colorRows = byId(colors);
  const logoRows = byId(logos);
  for (const s of schools) {
    if (!colorRows.has(s.unit_id) && !logoRows.has(s.unit_id) && !overrides[s.unit_id]) continue;
    const copy = structuredClone(s);
    applyBrand(copy, { colors: colorRows.get(s.unit_id), logo: logoRows.get(s.unit_id), override: overrides[s.unit_id] });
    assert.deepEqual(validateSchool(copy, meta), [], s.name);
  }
});
