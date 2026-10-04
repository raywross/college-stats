/**
 * Colors and marks (specs/school-identity/brand.md): the college's colors from Wikipedia's college color data (or its
 * article's infobox), the derived accent, monogram text color, and per-theme tints, and its stored site icon. Pure;
 * applied by lib/identity.ts. Decoration, never data.
 *
 *   1. `parseColorModule`: the Lua table `Module:College color/data` → entries (hex colors, names, the cited guide)
 *      and alias keys.
 *   2. `colorsForArticle`: an article's lead → its infobox's `colors`, `sports_nickname`, and `athletics_nickname`
 *      fields → a module key (exact, then alias, then normalized) or, when the module has none, the infobox's own hex
 *      values. Color names alone are never turned into colors.
 *   3. `deriveBrand`: accent, monogram text color, crest gradient end, and hero tints, computed here at sync time so the
 *      app does no color math.
 *   4. `applyBrand`: writes `school.brand` and its lineage from data/brand-colors.json, data/brand-logos.json, and
 *      data/brand-overrides.json (overrides last).
 */
import type { LineageRecord, School, SchoolBrand } from "./types";
import type { BrandColorEntry, BrandLogoEntry, BrandOverride } from "./identity-files";

export const MODULE_URL = "https://en.wikipedia.org/wiki/Module:College_color/data";

/* ------------------------------------------------------------------ */
/* Lua: a reader for the table literal the module returns              */
/* ------------------------------------------------------------------ */

export type LuaValue = string | number | boolean | null | LuaTable;
export interface LuaTable {
  kind: "table";
  /** Positional values, in order. */
  array: LuaValue[];
  /** Keyed values; keys are kept as strings (numbers as their decimal form). */
  hash: Map<string, LuaValue>;
}

const isTable = (v: LuaValue | undefined): v is LuaTable => !!v && typeof v === "object" && v.kind === "table";

const LUA_ESCAPES: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"', "'": "'", "\n": "\n" };

/** Parses `return <expression>` (or a bare expression) made of tables, strings, numbers, booleans, and nil. */
export function parseLua(src: string): LuaValue {
  let i = 0;
  const fail = (msg: string): never => {
    const line = src.slice(0, i).split("\n").length;
    throw new Error(`Lua parse error on line ${line}: ${msg}`);
  };
  const longOpen = /\[(=*)\[/y;
  const skip = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (!src.startsWith("--", i)) return;
      i += 2;
      longOpen.lastIndex = i;
      const m = longOpen.exec(src);
      if (m) {
        const close = `]${m[1]}]`;
        const end = src.indexOf(close, longOpen.lastIndex);
        if (end < 0) fail("unclosed long comment");
        i = end + close.length;
      } else {
        const nl = src.indexOf("\n", i);
        i = nl < 0 ? src.length : nl + 1;
      }
    }
  };
  const readString = (): string => {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      const c = src[i++];
      if (c === "\n") fail("newline in string");
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = src[i++];
      if (e in LUA_ESCAPES) out += LUA_ESCAPES[e];
      else if (e === "z") while (i < src.length && /\s/.test(src[i])) i++;
      else if (e === "x") {
        out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16));
        i += 2;
      } else if (e === "u") {
        const close = src.indexOf("}", i);
        out += String.fromCodePoint(parseInt(src.slice(i + 1, close), 16));
        i = close + 1;
      } else if (/\d/.test(e)) {
        let digits = e;
        while (digits.length < 3 && /\d/.test(src[i])) digits += src[i++];
        out += String.fromCharCode(Number(digits));
      } else fail(`unknown escape \\${e}`);
    }
    if (src[i] !== q) fail("unclosed string");
    i++;
    return out;
  };
  const readLongString = (level: string): string => {
    const close = `]${level}]`;
    const end = src.indexOf(close, i);
    if (end < 0) fail("unclosed long string");
    let s = src.slice(i, end);
    if (s.startsWith("\r\n")) s = s.slice(2);
    else if (s.startsWith("\n")) s = s.slice(1);
    i = end + close.length;
    return s;
  };
  const name = /[A-Za-z_][A-Za-z0-9_]*/y;
  const number = /0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const value = (): LuaValue => {
    skip();
    const c = src[i];
    if (c === "{") return table();
    if (c === '"' || c === "'") return readString();
    if (c === "[") {
      longOpen.lastIndex = i;
      const m = longOpen.exec(src);
      if (m) {
        i = longOpen.lastIndex;
        return readLongString(m[1]);
      }
    }
    if (c === "-" || /[\d.]/.test(c ?? "")) {
      const neg = c === "-";
      if (neg) i++;
      number.lastIndex = i;
      const m = number.exec(src);
      if (!m) fail("expected a number");
      i = number.lastIndex;
      return (neg ? -1 : 1) * Number(m![0]);
    }
    name.lastIndex = i;
    const m = name.exec(src);
    if (m) {
      i = name.lastIndex;
      if (m[0] === "true") return true;
      if (m[0] === "false") return false;
      if (m[0] === "nil") return null;
      fail(`unsupported expression "${m[0]}"`);
    }
    return fail(`unexpected "${c ?? "end of input"}"`);
  };
  const keyOf = (v: LuaValue): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fail("unsupported table key"));
  const table = (): LuaTable => {
    i++; // {
    const t: LuaTable = { kind: "table", array: [], hash: new Map() };
    for (;;) {
      skip();
      if (src[i] === "}") {
        i++;
        return t;
      }
      if (src[i] === "[" && !/^\[=*\[/.test(src.slice(i, i + 8))) {
        i++;
        const k = keyOf(value());
        skip();
        if (src[i] !== "]") fail('expected "]"');
        i++;
        skip();
        if (src[i] !== "=") fail('expected "="');
        i++;
        t.hash.set(k, value());
      } else {
        name.lastIndex = i;
        const m = name.exec(src);
        let keyed = false;
        if (m && !["true", "false", "nil"].includes(m[0])) {
          const after = name.lastIndex;
          let j = after;
          while (j < src.length && /\s/.test(src[j])) j++;
          if (src[j] === "=" && src[j + 1] !== "=") {
            i = j + 1;
            t.hash.set(m[0], value());
            keyed = true;
          }
        }
        if (!keyed) t.array.push(value());
      }
      skip();
      if (src[i] === "," || src[i] === ";") i++;
      else if (src[i] !== "}") fail('expected "," or "}"');
    }
  };
  skip();
  if (src.startsWith("return", i) && !/[A-Za-z0-9_]/.test(src[i + 6] ?? "")) i += 6;
  const out = value();
  skip();
  if (i < src.length) fail("trailing content");
  return out;
}

/* ------------------------------------------------------------------ */
/* Wikitext: templates, links, and the cite a module entry carries      */
/* ------------------------------------------------------------------ */

/** Decodes the entities and magic words the module and infoboxes use in plain text. */
export function decodeWikiText(s: string): string {
  return s
    .replace(/\{\{\s*!\s*\}\}/g, "|")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Drops HTML comments, <ref> tags, and <nowiki> wrappers: noise inside an infobox field. */
export function stripNoise(s: string): string {
  return s
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, "")
    .replace(/<\/?nowiki\s*\/?>/gi, "");
}

/** Splits text on `|` outside nested `{{…}}` and `[[…]]`. */
export function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let braces = 0;
  let brackets = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("{{", i)) {
      braces++;
      i++;
    } else if (s.startsWith("}}", i) && braces > 0) {
      braces--;
      i++;
    } else if (s.startsWith("[[", i)) {
      brackets++;
      i++;
    } else if (s.startsWith("]]", i) && brackets > 0) {
      brackets--;
      i++;
    } else if (s[i] === "|" && braces === 0 && brackets === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

export interface Template {
  /** As written, trimmed, first letter upper case, underscores as spaces: "College color list". */
  name: string;
  /** Positional parameters, in order. */
  positional: string[];
  /** Named parameters, names lower-cased and trimmed. */
  named: Map<string, string>;
  /** Offsets of the whole `{{…}}` in the text searched. */
  start: number;
  end: number;
}

const templateName = (raw: string) => {
  const n = raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/** Every top-level template in `text` (templates nested inside another are left in its parameters). */
export function topTemplates(text: string): Template[] {
  const out: Template[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{{", i);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text.startsWith("{{", j)) {
        depth++;
        j++;
      } else if (text.startsWith("}}", j)) {
        depth--;
        j++;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break; // unbalanced: stop rather than guess
    const inner = text.slice(open + 2, j - 1);
    const parts = splitTopLevel(inner);
    const named = new Map<string, string>();
    const positional: string[] = [];
    for (const p of parts.slice(1)) {
      const eq = p.indexOf("=");
      // A "=" inside a nested template or link isn't a parameter name.
      const head = eq < 0 ? "" : p.slice(0, eq);
      if (eq > 0 && !/[{}[\]]/.test(head)) named.set(head.trim().toLowerCase(), p.slice(eq + 1).trim());
      else positional.push(p.trim());
    }
    out.push({ name: templateName(parts[0] ?? ""), positional, named, start: open, end: j + 1 });
    i = j + 1;
  }
  return out;
}

/** Every template in `text`, nested ones included (depth first). */
export function allTemplates(text: string): Template[] {
  const out: Template[] = [];
  for (const t of topTemplates(text)) {
    out.push(t);
    for (const p of [...t.positional, ...t.named.values()]) out.push(...allTemplates(p));
  }
  return out;
}

/** `[[Target|label]]` and `[[Target]]` link targets in `text`, in order; files and categories are skipped. */
export function linkTargets(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]/g)) {
    const target = decodeWikiText(m[1]).replace(/_/g, " ").replace(/#.*$/, "").trim();
    if (target && !/^(?:file|image|category|wikt|wiktionary|commons):/i.test(target)) out.push(target);
  }
  return out;
}

/** Wiki markup to plain text: links to their labels, templates and bold/italic dropped. */
export function plainText(s: string): string {
  let t = stripNoise(s);
  for (let k = 0; k < 4 && /\{\{/.test(t); k++) t = t.replace(/\{\{[^{}]*\}\}/g, "");
  t = t
    .replace(/\[\[(?:[^[\]|]*\|)?([^[\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<[^>]+>/g, "");
  return decodeWikiText(t).replace(/\s+/g, " ").trim();
}

export interface CiteRef {
  /** "cite web", "cite manual", "cite book", …; "link" for a bare external link. */
  kind: string;
  url: string | null;
  title: string | null;
}

/** The first citation in a module entry's `cite` text: a `{{cite …}}` template, else a bare `[url title]` link. */
export function parseCite(text: string): CiteRef | null {
  for (const t of allTemplates(text)) {
    if (!/^Cite\b/i.test(t.name)) continue;
    const url = t.named.get("url")?.trim() || null;
    const title = t.named.get("title") ?? t.named.get("work") ?? t.named.get("website") ?? t.named.get("publisher") ?? null;
    return { kind: t.name.toLowerCase(), url: url ? decodeWikiText(url) : null, title: title ? plainText(title) || null : null };
  }
  const m = /\[(https?:\/\/[^\s\]]+)\s*([^\]]*)\]/.exec(text);
  return m ? { kind: "link", url: decodeWikiText(m[1]), title: plainText(m[2]) || null } : null;
}

/* ------------------------------------------------------------------ */
/* The module: entries and aliases                                     */
/* ------------------------------------------------------------------ */

export interface ColorModuleEntry {
  key: string;
  /** "#RRGGBB", upper case, brand order. */
  colors: string[];
  /** name1…nameN aligned with `colors`; null where the module names no color (often the white text slot). */
  names: (string | null)[];
  /** The module's `order` (the order the named colors are listed in), when given. */
  order: string | null;
  cite: CiteRef | null;
}

export interface ColorModule {
  entries: Map<string, ColorModuleEntry>;
  /** Alias key → the key it points to (as written; may point to another alias). */
  aliases: Map<string, string>;
}

/** "ba0c2f", "#BA0C2F", "fff" → "#BA0C2F"; null for anything that isn't a hex color. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toUpperCase()}`;
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${s.split("").map((c) => c + c).join("").toUpperCase()}`;
  return null;
}

export function parseColorModule(src: string): ColorModule {
  const root = parseLua(src);
  if (!isTable(root)) throw new Error("Module:College color/data: expected the module to return a table");
  const entries = new Map<string, ColorModuleEntry>();
  const aliases = new Map<string, string>();
  for (const [key, v] of root.hash) {
    if (typeof v === "string") {
      aliases.set(key, v);
      continue;
    }
    if (!isTable(v)) continue;
    const colors = v.array.map(normalizeHex).filter((c): c is string => !!c);
    if (!colors.length) continue;
    const names = colors.map((_, k) => {
      const n = v.hash.get(`name${k + 1}`);
      return typeof n === "string" && n.trim() ? decodeWikiText(n.trim()) : null;
    });
    const cite = v.hash.get("cite");
    const order = v.hash.get("order");
    entries.set(key, {
      key,
      colors,
      names,
      order: typeof order === "string" || typeof order === "number" ? String(order) : null,
      cite: typeof cite === "string" ? parseCite(cite) : null,
    });
  }
  return { entries, aliases };
}

/**
 * The join key for near-misses: no accents, any dash as a space, "&" as "and", no periods or apostrophes, and "St"
 * after the first word read as "State" ("Ball St. Cardinals"). A leading "St." stays (Saint).
 */
export function normalizeKey(key: string): string {
  const words = key
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‐‑‒–—―\-/]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return words.map((w, k) => (k > 0 && w === "st" ? "state" : w)).join(" ");
}

export type JoinVia = "key" | "alias" | "normalized";

/** Normalized key → entry key, keeping only normalized forms that point to exactly one entry. */
function normalizedIndex(mod: ColorModule): Map<string, string> {
  const cached = NORMALIZED.get(mod);
  if (cached) return cached;
  const seen = new Map<string, Set<string>>();
  const add = (k: string, target: string) => {
    const n = normalizeKey(k);
    seen.set(n, (seen.get(n) ?? new Set()).add(target));
  };
  for (const k of mod.entries.keys()) add(k, k);
  for (const k of mod.aliases.keys()) {
    const target = resolveAlias(mod, k);
    if (target) add(k, target);
  }
  const out = new Map<string, string>();
  for (const [n, targets] of seen) if (targets.size === 1) out.set(n, [...targets][0]);
  NORMALIZED.set(mod, out);
  return out;
}
const NORMALIZED = new WeakMap<ColorModule, Map<string, string>>();

/** Follows an alias (and aliases of aliases, a few hops) to an entry key. */
function resolveAlias(mod: ColorModule, key: string): string | null {
  let k = key;
  for (let hops = 0; hops < 5; hops++) {
    if (mod.entries.has(k)) return k;
    const next = mod.aliases.get(k);
    if (next === undefined) return null;
    k = next;
  }
  return null;
}

/**
 * A team name (an infobox's key or nickname link) → the module entry: exact key, then alias key, then normalized key.
 * The normalized step also tries an athletics article's men's half: "Central Arkansas Bears and Sugar Bears" →
 * "Central Arkansas Bears" (the module keys programs by the men's nickname and aliases the women's).
 */
export function joinTeam(mod: ColorModule, team: string): { entry: ColorModuleEntry; via: JoinVia } | null {
  const name = decodeWikiText(team).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return null;
  const exact = mod.entries.get(name);
  if (exact) return { entry: exact, via: "key" };
  if (mod.aliases.has(name)) {
    const k = resolveAlias(mod, name);
    if (k) return { entry: mod.entries.get(k)!, via: "alias" };
  }
  const index = normalizedIndex(mod);
  const tries = [name];
  // Every " and " from the right: "Hobart and William Smith Statesmen and Herons" → "Hobart and William Smith Statesmen".
  for (let at = name.lastIndexOf(" and "); at > 0; at = name.lastIndexOf(" and ", at - 1)) tries.push(name.slice(0, at));
  for (const t of tries) {
    const n = mod.entries.has(t) ? t : (resolveAlias(mod, t) ?? index.get(normalizeKey(t)));
    if (n) return { entry: mod.entries.get(n)!, via: "normalized" };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The infobox: three shapes                                           */
/* ------------------------------------------------------------------ */

/** Infobox templates whose name says it's about an institution; any other infobox is a fallback. */
const INSTITUTION_INFOBOX = /^Infobox\s+(?:.*\b)?(?:universit|college|school|institut|academy|seminary|conservatory|polytechnic)/i;

/** The college's infobox in an article lead: the first institution infobox, else the first infobox. */
export function findInfobox(lead: string): Template | null {
  const boxes = topTemplates(stripNoise(lead)).filter((t) => /^Infobox\b/i.test(t.name));
  return boxes.find((t) => INSTITUTION_INFOBOX.test(t.name)) ?? boxes[0] ?? null;
}

/** Templates that print a module entry by its key: `{{college color list|team=Georgia Bulldogs}}` and relatives. */
const KEY_TEMPLATE = /^College ?colou?r|^Collegecolou?r|^College ?(?:primary|secondary)/i;
/** `{{color box|#4F2D7F}}` and its spellings. */
const BOX_TEMPLATE = /^Colou?r ?box(?:es)?$|^Colou?rbox$|^Colou?r ?swatch$|^Colou?r ?sample$/i;
/** The only color names that are exact whoever writes them; every other name ("maroon", "gold") is left alone. */
const EXACT_NAMES: Record<string, string> = { black: "#000000", white: "#FFFFFF" };

export interface InfoboxColors {
  /** Module keys named by the `colors` field's templates, in order. */
  keys: string[];
  /** Link targets of `sports_nickname` / `athletics_nickname`, in order. */
  nicknameLinks: string[];
  /** Hex values from the `colors` field's color boxes, in order. */
  hexes: string[];
  /** The `colors` field as plain text ("Purple & gray"), or null when there is no field. */
  text: string | null;
  /** The `colors` field as written, for the lineage quote. */
  raw: string | null;
}

const field = (box: Template, ...names: string[]) => {
  for (const n of names) {
    const v = box.named.get(n);
    if (v !== undefined && v.trim()) return v;
  }
  return null;
};

/** The `colors`, `sports_nickname`, and `athletics_nickname` fields of an infobox, read for the join. */
export function infoboxColors(box: Template): InfoboxColors {
  const colors = field(box, "colors", "colours", "color", "colour", "school_colors", "school_colours");
  const keys: string[] = [];
  let hexes: string[] = [];
  if (colors) {
    // Each color box in order: a hex value as written, "black"/"white" (exact whatever the source), or another name.
    const boxes: { hex: string | null; written: boolean }[] = [];
    for (const t of allTemplates(colors)) {
      if (KEY_TEMPLATE.test(t.name)) {
        const k = t.named.get("team") ?? t.named.get("1") ?? t.positional[0];
        if (k?.trim()) keys.push(plainText(k));
      } else if (BOX_TEMPLATE.test(t.name)) {
        const v = (t.positional[0] ?? t.named.get("1") ?? "").trim();
        const written = v.startsWith("#") || /^[0-9a-f]{6}$/i.test(v) ? normalizeHex(v) : null;
        boxes.push({ hex: written ?? EXACT_NAMES[v.toLowerCase()] ?? null, written: !!written });
      }
    }
    // Hex values only count when at least one box is written in hex: a field of names ("maroon", "gold") is never
    // turned into colors, but "black" and "white" beside a hex value are exact.
    if (boxes.some((b) => b.written)) hexes = boxes.map((b) => b.hex).filter((h): h is string => !!h);
    // A bare "#4F2D7F" written in the field (some boxes use a style attribute rather than a template).
    if (!boxes.length && !keys.length) for (const m of stripNoise(colors).matchAll(/#([0-9a-f]{6})\b/gi)) hexes.push(`#${m[1].toUpperCase()}`);
  }
  const nicknameLinks = ["sports_nickname", "athletics_nickname"].flatMap((n) => linkTargets(field(box, n) ?? ""));
  return { keys, nicknameLinks, hexes, text: colors ? plainText(colors) || null : null, raw: colors ? stripNoise(colors).trim() : null };
}

/** Names written after an infobox's color boxes ("Purple & gray"), when there is one per color. */
export function namesFromText(text: string | null, count: number): string[] | null {
  if (!text || count === 0) return null;
  const parts = text
    .replace(/\([^)]*\)/g, "")
    .split(/\s*(?:,|&|\band\b|\/|;|\+|·|•)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p && !/^#?[0-9a-f]{6}$/i.test(p));
  return parts.length === count && parts.every((p) => p.length <= 40) ? parts : null;
}

export interface FoundColors {
  colors: string[];
  names: (string | null)[] | null;
  /** The module key, or null for colors read from the infobox. */
  key: string | null;
  cite_url: string | null;
  cite_title: string | null;
  via: JoinVia | "infobox";
  /** For infobox colors: the field as written (the lineage quote). */
  quote?: string;
}

/** Why an article gave no colors (the sync's summary counts these). */
export type ColorsMiss = "no infobox" | "no colors in the infobox" | "color names only" | "team not in the module";

/**
 * An article's colors: its infobox's module key (from `{{college color list|team=…}}`), else its sports nickname's
 * link target, joined to the module by key, alias, or normalized key; else the infobox's own hex values. Names alone
 * ("Red and black") are never turned into colors.
 */
export function colorsForArticle(lead: string, mod: ColorModule): { colors: FoundColors; reason: null } | { colors: null; reason: ColorsMiss } {
  const box = findInfobox(lead);
  if (!box) return { colors: null, reason: "no infobox" };
  const info = infoboxColors(box);
  for (const team of [...info.keys, ...info.nicknameLinks]) {
    const hit = joinTeam(mod, team);
    if (!hit) continue;
    const e = hit.entry;
    return {
      colors: {
        colors: e.colors,
        names: e.names.some((n) => n !== null) ? e.names : null,
        key: e.key,
        cite_url: e.cite?.url ?? null,
        cite_title: e.cite?.title ?? null,
        via: hit.via,
      },
      reason: null,
    };
  }
  if (info.hexes.length) {
    const unique = [...new Set(info.hexes)];
    return {
      colors: { colors: unique, names: namesFromText(info.text, unique.length), key: null, cite_url: null, cite_title: null, via: "infobox", quote: (info.raw ?? "").slice(0, 160) },
      reason: null,
    };
  }
  if (info.keys.length || info.nicknameLinks.length) return { colors: null, reason: "team not in the module" };
  return { colors: null, reason: info.text ? "color names only" : "no colors in the infobox" };
}

/* ------------------------------------------------------------------ */
/* Color math (OKLab / OKLCH, WCAG contrast), used at sync time only    */
/* ------------------------------------------------------------------ */

export interface Oklch {
  l: number;
  c: number;
  /** Degrees, 0–360; 0 for grays. */
  h: number;
}

type Rgb = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** "#BA0C2F" → gamma-encoded sRGB channels, 0–1. */
export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex);
  if (!h) throw new Error(`not a hex color: ${hex}`);
  return [0, 2, 4].map((k) => parseInt(h.slice(1 + k, 3 + k), 16) / 255) as Rgb;
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Gamma-encoded sRGB → OKLCH (Björn Ottosson's OKLab). */
export function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c, h: (h + 360) % 360 };
}

/** OKLCH → gamma-encoded sRGB, not clamped (channels outside 0–1 mean out of gamut). */
export function oklchToRgb({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => (v < 0 ? -toGamma(-v) : toGamma(v))) as Rgb;
}

export const hexToOklch = (hex: string) => rgbToOklch(hexToRgb(hex));

const inGamut = (rgb: Rgb, eps = 1e-4) => rgb.every((v) => v >= -eps && v <= 1 + eps);

/** The most chroma (up to `cap`) a color of lightness `l` and hue `h` can have inside sRGB. */
export function maxChroma(l: number, h: number, cap: number): number {
  if (inGamut(oklchToRgb({ l, c: cap, h }))) return cap;
  let lo = 0;
  let hi = cap;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgb({ l, c: mid, h }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** WCAG 2 relative luminance of a hex color. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two hex colors (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** A color is "neutral" (white, black, or gray) at OKLCH chroma 0.03 or less. */
export const CHROMA_NEUTRAL = 0.03;
/** The monogram's text needs this much contrast on its tile. */
export const TEXT_CONTRAST = 4.5;
/** Hero tints: the accent re-lit to these OKLCH lightnesses, chroma capped. */
export const TINT_LIGHT_L = 0.72;
export const TINT_DARK_L = 0.62;
export const TINT_MAX_CHROMA = 0.16;

const isNeutral = (hex: string) => hexToOklch(hex).c <= CHROMA_NEUTRAL;

/** The first color that is neither white, black, nor gray (chroma > 0.03), else the first color. */
export function pickAccent(colors: readonly string[]): string {
  return colors.find((c) => !isNeutral(c)) ?? colors[0];
}

/** "white" or "black", whichever has more contrast on `hex` (one of them always reaches 4.5:1). */
export function onAccent(hex: string): "white" | "black" {
  return contrast(hex, "#FFFFFF") >= contrast(hex, "#000000") ? "white" : "black";
}

/** `{ l, c, h }` as a CSS `oklch()` string: lightness 2 decimals, chroma 3 (rounded down), hue 1. */
export function oklchCss({ l, c, h }: Oklch): string {
  const r = (v: number, d: number) => String(Number(v.toFixed(d)));
  const chroma = Math.floor(c * 1000) / 1000;
  return `oklch(${r(l, 2)} ${r(chroma, 3)} ${chroma === 0 ? 0 : r(h, 1)})`;
}

/** "oklch(0.72 0.16 20)" → `{ l, c, h }`; null for anything else. */
export function parseOklch(css: string): Oklch | null {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+\s*)?\)$/.exec(css.trim());
  return m ? { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) } : null;
}

/** `hex` re-lit to lightness `l`, hue kept, chroma at most `cap` and inside sRGB, as a CSS string. */
export function relight(hex: string, l: number, cap = TINT_MAX_CHROMA): string {
  const { c, h } = hexToOklch(hex);
  const chroma = c <= 1e-4 ? 0 : Math.min(c, cap, maxChroma(l, h, Math.min(c, cap)));
  return oklchCss({ l, c: chroma, h });
}

/** `hex` lighter (+) or darker (−) by `dl` in OKLCH lightness, hue kept, chroma fitted inside sRGB. */
export function shade(hex: string, dl: number): string {
  const { l, c, h } = hexToOklch(hex);
  const nl = Math.min(0.98, Math.max(0.05, l + dl));
  return rgbToHex(oklchToRgb({ l: nl, c: c <= 1e-4 ? 0 : maxChroma(nl, h, c), h }));
}

/** How far the crest gradient's end is lightened or darkened from the accent, at most. */
export const CREST_SHADE = 0.12;
const isWhitish = (hex: string) => {
  const o = hexToOklch(hex);
  return o.c <= CHROMA_NEUTRAL && o.l >= 0.9;
};

/**
 * The crest gradient's end color: the next brand color after the accent (wrapping around), white skipped (in the
 * module it's usually the text-color slot, not a brand color). A black or gray one becomes a darkened accent; when
 * only white is left, a lightened accent. Either way the end keeps the monogram's text at 4.5:1 or more: a second
 * color that wouldn't is replaced by a shade, and a shade steps back toward the accent until it does.
 */
export function crestEnd(colors: readonly string[], accent: string, text: "white" | "black"): string {
  const textHex = text === "white" ? "#FFFFFF" : "#000000";
  const at = colors.indexOf(accent);
  const rest = [...colors.slice(at + 1), ...colors.slice(0, Math.max(0, at))].filter((c) => c !== accent);
  const next = rest.find((c) => !isWhitish(c));
  if (next && !isNeutral(next) && contrast(next, textHex) >= TEXT_CONTRAST) return next;
  // A shade, in the direction the brand suggests: darker for a black/gray (or unreadable) second color, lighter for white.
  const dir = next ? -1 : 1;
  for (let step = CREST_SHADE; step > 0.005; step -= 0.01) {
    const s = shade(accent, dir * step);
    if (contrast(s, textHex) >= TEXT_CONTRAST) return s;
  }
  // Neither direction reads well this far from the accent: try the other one before giving up on a gradient.
  for (let step = CREST_SHADE; step > 0.005; step -= 0.01) {
    const s = shade(accent, -dir * step);
    if (contrast(s, textHex) >= TEXT_CONTRAST) return s;
  }
  return accent;
}

export interface DerivedBrand {
  accent: string;
  on_accent: "white" | "black";
  crest_to: string;
  tint_light: string;
  tint_dark: string;
}

/** Everything the app shows that's computed from the colors, so the app does no color math. */
export function deriveBrand(colors: readonly string[]): DerivedBrand {
  const accent = pickAccent(colors);
  const on_accent = onAccent(accent);
  return {
    accent,
    on_accent,
    crest_to: crestEnd(colors, accent, on_accent),
    tint_light: relight(accent, TINT_LIGHT_L),
    tint_dark: relight(accent, TINT_DARK_L),
  };
}

/* ------------------------------------------------------------------ */
/* Applying: school.brand and its lineage                              */
/* ------------------------------------------------------------------ */

/** One college's brand inputs. */
export interface BrandInputs {
  colors: BrandColorEntry | undefined;
  logo: BrandLogoEntry | undefined;
  override: BrandOverride | undefined;
}

/**
 * Lineage for colors from the module: the brand or athletics guide the entry cites is the URL (the module's page
 * when it cites none), the module key is the `field` the colors sit under, and the guide's title is the quote. Colors
 * read from an article's infobox cite the article, with the field as written.
 */
export function colorsLineage(e: BrandColorEntry): LineageRecord {
  if (e.key) {
    return {
      source: "wikipedia",
      method: "reported",
      url: e.cite_url ?? MODULE_URL,
      field: e.key,
      retrieved: e.retrieved,
      ...(e.cite_title ? { quote: e.cite_title } : {}),
    };
  }
  return { source: "wikipedia", method: "reported", url: e.article, field: "infobox colors", retrieved: e.retrieved, ...(e.quote ? { quote: e.quote } : {}) };
}

/** The mark: the icon file's URL, as extracted from the college's own site (validateSchool requires all five). */
export function logoLineage(l: BrandLogoEntry): LineageRecord {
  return {
    source: "college-site",
    method: "extracted",
    url: l.source_url,
    retrieved: l.retrieved,
    year: l.retrieved.slice(0, 4),
    quote: l.tag ?? "the site icon",
  };
}

const BRAND_LINEAGE = (path: string) => path === "brand" || path.startsWith("brand.");

/** Problems with one override (data/brand-overrides.json): corrected colors must be hex and say where they came from. */
export function overrideProblems(id: string, o: BrandOverride): string[] {
  const out: string[] = [];
  if (o.logo !== undefined && o.logo !== false) out.push(`brand-overrides.json ${id}: "logo" can only be false`);
  if (o.colors !== undefined) {
    if (!Array.isArray(o.colors) || !o.colors.length) out.push(`brand-overrides.json ${id}: "colors" must be a non-empty list`);
    else if (o.colors.some((c) => !normalizeHex(c))) out.push(`brand-overrides.json ${id}: every color must be a hex value like "#BA0C2F"`);
    if (!o._lineage?.source || !o._lineage.url) out.push(`brand-overrides.json ${id}: corrected colors need "_lineage" {source, url} (the college's brand guide)`);
    if (o.names && o.names.length !== o.colors?.length) out.push(`brand-overrides.json ${id}: "names" must have one name per color`);
  } else if (o.names) out.push(`brand-overrides.json ${id}: "names" without "colors"`);
  return out;
}

/**
 * Sets `brand` (colors, derived fields, logo) from the brand files, overrides last. Replaces any earlier `brand` and
 * every `brand.*` lineage record, and leaves no `brand` key when the college has neither colors nor a mark, so
 * applying twice gives the same school.
 */
export function applyBrand(school: School, inputs: BrandInputs): void {
  delete school.brand;
  if (school.lineage) {
    const keys = Object.keys(school.lineage).filter(BRAND_LINEAGE);
    for (const k of keys) delete (school.lineage as Record<string, unknown>)[k];
    if (keys.length && !Object.keys(school.lineage).length) delete school.lineage;
  }

  const { colors: entry, logo, override } = inputs;
  if (override) {
    const problems = overrideProblems(school.unit_id, override);
    if (problems.length) throw new Error(problems.join("; "));
  }
  let colors: string[] | null = entry?.colors.map((c) => normalizeHex(c)!).filter(Boolean) ?? null;
  let names: (string | null)[] | null = entry?.names ?? null;
  let colorRec: LineageRecord | null = entry ? colorsLineage(entry) : null;
  if (override?.colors) {
    colors = override.colors.map((c) => normalizeHex(c)!);
    names = override.names ?? null;
    colorRec = override._lineage!;
  }
  if (colors && !colors.length) colors = null;
  const mark = logo && override?.logo !== false ? logo : undefined;
  if (!colors && !mark) return;

  const derived = colors ? deriveBrand(colors) : null;
  const brand: SchoolBrand = {
    colors,
    names: colors ? names : null,
    accent: derived?.accent ?? null,
    on_accent: derived?.on_accent ?? null,
    crest_to: derived?.crest_to ?? null,
    tint_light: derived?.tint_light ?? null,
    tint_dark: derived?.tint_dark ?? null,
    logo: mark ? { source_url: mark.source_url, retrieved: mark.retrieved, width: mark.width } : null,
  };
  school.brand = brand;
  const lineage: Record<string, LineageRecord> = {};
  if (colors && colorRec) {
    lineage["brand.colors"] = colorRec;
    if (brand.names) lineage["brand.names"] = colorRec;
  }
  if (mark) lineage["brand.logo"] = logoLineage(mark);
  if (Object.keys(lineage).length) school.lineage = { ...(school.lineage ?? {}), ...lineage };
}
