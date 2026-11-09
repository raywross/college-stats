/**
 * What a page's inline RSC payload carries, split by the client component it feeds (round 5, U3;
 * specs/serving-architecture.md "Round 5: the public pages' payload"). Pure: the caller passes the page's HTML (and,
 * for a production build, the client-reference manifests' module id → file map), and gets back the HTML size, the
 * inline scripts' size, the Flight stream rebuilt from `self.__next_f.push([1,"…"])`, and every client element's props
 * ranked by their serialized size. Used by scripts/measure-page-payload.mts and tests/public-payload.test.mts.
 *
 * The Flight stream is a sequence of rows `<hex id>:<payload>`; a client component is a row `I[moduleId, chunks,
 * exportName]`, and an element that renders one is `["$", "$L<row>", key, props]` in a model row. A prop that is
 * itself outlined (`"$<row>"`) counts that row's size too, once per reference.
 */

export type Row = { id: string; tag: string; text: string; json?: unknown };
export type PropSize = { component: string; prop: string; bytes: number; count: number };
export type PagePayload = {
  htmlBytes: number;
  /** Sum of every `<script>` without `src`'s text: the brief's "inline RSC", which includes Next's small bootstrap. */
  inlineScriptBytes: number;
  /** The Flight stream's own bytes (UTF-8), rebuilt from the pushes. */
  flightBytes: number;
  rows: number;
  /** Every client element's props (children excluded), summed: what client components are handed. */
  clientPropBytes: number;
  /** Inline `<svg>` subtrees rendered on the server (outermost only): markup the payload repeats. */
  svgBytes: number;
  /** `className` strings on every element (plus the key's own bytes). */
  classNameBytes: number;
  /** Per component and prop (summed across that component's elements), largest first; `children` excluded. */
  props: PropSize[];
  /** Per component: elements and their props' bytes (children excluded), largest first. */
  components: { component: string; elements: number; bytes: number }[];
};

const utf8 = (s: string) => Buffer.byteLength(s, "utf8");

/** The inline scripts' texts (`<script>` with no `src`). */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (/\ssrc\s*=/.test(m[1] ?? "")) continue;
    out.push(m[2]);
  }
  return out;
}

/** The Flight stream: every `self.__next_f.push([1,"…"])` string, in order, joined. */
export function flightOf(html: string): string {
  let out = "";
  for (const s of inlineScripts(html)) {
    const m = /^\s*\(self\.__next_f\s*=\s*self\.__next_f\s*\|\|\s*\[\]\)\.push\((\[[\s\S]*\])\)\s*;?\s*$/.exec(s) ?? /^\s*self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?\s*$/.exec(s);
    if (!m) continue;
    const arr = JSON.parse(m[1]) as unknown[];
    if (arr[0] === 1 && typeof arr[1] === "string") out += arr[1];
  }
  return out;
}

/** Splits a Flight stream into rows (text rows `T<hex len>,` are length-prefixed in UTF-8 bytes; the rest end at a newline). */
export function parseRows(flight: string): Row[] {
  const rows: Row[] = [];
  const buf = Buffer.from(flight, "utf8");
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) break;
    const id = buf.subarray(i, colon).toString("utf8");
    let j = colon + 1;
    // A tag is one or two capital letters before the data (I, HL, T, E, D, W…).
    let tag = "";
    while (j < buf.length && buf[j] >= 0x41 && buf[j] <= 0x5a && tag.length < 2) tag += String.fromCharCode(buf[j++]);
    if (tag === "T") {
      const comma = buf.indexOf(0x2c, j);
      const len = parseInt(buf.subarray(j, comma).toString("utf8"), 16);
      const text = buf.subarray(comma + 1, comma + 1 + len).toString("utf8");
      rows.push({ id, tag, text });
      i = comma + 1 + len;
      continue;
    }
    // Not a tag after all when the data is JSON starting with a letter-free token; a row's JSON never starts with A–Z.
    const nl = buf.indexOf(0x0a, j);
    const end = nl < 0 ? buf.length : nl;
    const text = buf.subarray(j, end).toString("utf8");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    rows.push({ id, tag, text, json });
    i = end + 1;
  }
  return rows;
}

/**
 * Measures a page. `moduleNames` maps a client reference's module id to a readable name (a production build's ids are
 * numbers; scripts/measure-page-payload.mts reads them from the client-reference manifests); without it, the id itself.
 */
export function measurePayload(html: string, moduleNames: Map<string, string> = new Map()): PagePayload {
  const scripts = inlineScripts(html);
  const flight = flightOf(html);
  const rows = parseRows(flight);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const clientName = new Map<string, string>();
  for (const r of rows) {
    if (r.tag !== "I" || !Array.isArray(r.json)) continue;
    const [mod, , exp] = r.json as [string | number, unknown, string];
    const file = moduleNames.get(String(mod)) ?? String(mod);
    clientName.set(r.id, exp && exp !== "default" && exp !== "*" ? `${exp} (${file})` : file);
  }

  const props = new Map<string, PropSize>();
  const comps = new Map<string, { component: string; elements: number; bytes: number }>();
  const sizeOf = (v: unknown, seen: Set<string>): number => {
    let n = utf8(JSON.stringify(v) ?? "");
    // Outlined values ("$<hex>", "$@<hex>", "$Q<hex>"…) count the row they point at, once per reference. A path
    // reference ("$<hex>:props:…") is React's dedup of a value already sent: only its own few bytes.
    const walk = (x: unknown) => {
      if (typeof x === "string") {
        const m = /^\$[@QWKBn]?([0-9a-f]+)$/.exec(x);
        if (m && byId.has(m[1]) && !seen.has(m[1])) {
          seen.add(m[1]);
          const r = byId.get(m[1])!;
          n += utf8(r.text);
          if (r.json !== undefined) walk(r.json);
        }
      } else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    };
    walk(v);
    return n;
  };
  let svgBytes = 0;
  let classNameBytes = 0;
  let inSvg = 0;
  const visit = (x: unknown) => {
    if (Array.isArray(x)) {
      const isElement = x[0] === "$" && typeof x[1] === "string" && x[3] && typeof x[3] === "object";
      if (isElement) {
        const cls = (x[3] as Record<string, unknown>).className;
        if (typeof cls === "string") classNameBytes += utf8(cls) + 14;
      }
      if (isElement && x[1] === "svg" && !inSvg) svgBytes += utf8(JSON.stringify(x));
      if (isElement && x[1] === "svg") {
        inSvg++;
        x.forEach(visit);
        inSvg--;
        return;
      }
      if (x[0] === "$" && typeof x[1] === "string" && x[1].startsWith("$L") && x[3] && typeof x[3] === "object") {
        const ref = x[1].slice(2);
        const component = clientName.get(ref) ?? `$L${ref}`;
        const c = comps.get(component) ?? { component, elements: 0, bytes: 0 };
        c.elements++;
        for (const [prop, value] of Object.entries(x[3] as Record<string, unknown>)) {
          if (prop === "children") continue;
          const bytes = sizeOf(value, new Set());
          c.bytes += bytes;
          const key = `${component}\u0000${prop}`;
          const p = props.get(key) ?? { component, prop, bytes: 0, count: 0 };
          p.bytes += bytes;
          p.count++;
          props.set(key, p);
        }
        comps.set(component, c);
      }
      x.forEach(visit);
    } else if (x && typeof x === "object") Object.values(x).forEach(visit);
  };
  for (const r of rows) if (r.tag === "" && r.json !== undefined) visit(r.json);

  return {
    htmlBytes: utf8(html),
    inlineScriptBytes: scripts.reduce((n, s) => n + utf8(s), 0),
    flightBytes: utf8(flight),
    rows: rows.length,
    clientPropBytes: [...comps.values()].reduce((n, c) => n + c.bytes, 0),
    svgBytes,
    classNameBytes,
    props: [...props.values()].sort((a, b) => b.bytes - a.bytes),
    components: [...comps.values()].sort((a, b) => b.bytes - a.bytes),
  };
}

/**
 * The field paths of every whole citation in a Flight stream (a `Cited` serializes `"path":…,"field":…,"method":…`;
 * a reference has no `field` or `method`): what the payload guard checks reaches no client component unexpectedly.
 */
export function fullCitationPaths(flight: string): string[] {
  return [...flight.matchAll(/"path":"([^"]+)","field":"(?:[^"\\]|\\.)*","method":/g)].map((m) => m[1]);
}

/** Readable text of a page's body as a browser would show it, for the identity check: no scripts, styles, or tags. */
export function pageText(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<template[\s\S]*?<\/template>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** The page's markup without scripts and with build-specific asset paths normalized: the stricter identity check. */
export function pageMarkup(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/\/_next\/static\/[^"' )]+/g, "/_next/static/…")
    .replace(/<!--[\s\S]*?-->/g, "");
}
