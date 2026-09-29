/**
 * Renders a spec's markdown for /roadmap/{slug} (specs/roadmap.md). Pure, so tests can run it: links to other
 * roadmap specs become /roadmap pages, other repo links go to GitHub, and headings get GitHub-style ids so the specs'
 * own #anchors keep working.
 */
import { posix } from "node:path";
import { Marked } from "marked";
import { roadmapPages } from "./roadmap.ts";

export const REPO_URL = "https://github.com/raywross/college-stats";
const REPO_BLOB = `${REPO_URL}/blob/main/`;

export interface RenderedSpec {
  /** The H1, without a trailing "(Source)" parenthetical. */
  title: string;
  /** The trailing parenthetical of the H1 (e.g. "IPEDS ADM"), if any. */
  source: string | null;
  html: string;
  /** Level-2 headings, for the "On this page" list. */
  toc: { id: string; text: string }[];
}

/** GitHub's heading anchors: lower case, punctuation dropped, each space a hyphen. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** The repo file a relative link in `fromFile` points at, or null for external, absolute, and same-page links. */
function repoPath(href: string, fromFile: string): { path: string; anchor: string } | null {
  if (/^[a-z][a-z+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return null;
  const [target, hash] = href.split("#", 2);
  let path = posix.normalize(posix.join(posix.dirname(fromFile), target));
  if (target.endsWith("/")) path = posix.join(path, "README.md");
  return { path, anchor: hash ? `#${hash}` : "" };
}

/** Where a link in `fromFile` should point on the site. */
export function resolveHref(href: string, fromFile: string): string {
  const target = repoPath(href, fromFile);
  if (!target) return href;
  const page = roadmapPages().find((p) => p.file === target.path);
  return page ? `/roadmap/${page.slug}${target.anchor}` : `${REPO_BLOB}${target.path}${target.anchor}`;
}

/** The H1 of a spec's markdown, for link text. */
export function specHeading(markdown: string): string | null {
  return markdown.match(/^# (.+)$/m)?.[1].trim() ?? null;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const unescape = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * `titles` maps repo paths to spec titles: a link whose text is just the file name ("majors.md") shows the title
 * instead, which reads better on the site than it does in the repo.
 */
export function renderSpec(markdown: string, file: string, titles: Map<string, string> = new Map()): RenderedSpec {
  let heading = "";
  const toc: RenderedSpec["toc"] = [];
  const used = new Map<string, number>();

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = unescape(this.parser.parseInline(tokens, this.parser.textRenderer));
        if (depth === 1 && !heading) {
          heading = text;
          return "";
        }
        const base = slugify(text);
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        if (depth === 2) toc.push({ id, text });
        return `<h${depth} id="${escapeAttr(id)}">${inner}</h${depth}>\n`;
      },
      link({ href, title, text, tokens }) {
        const url = resolveHref(href, file);
        const external = /^https?:/.test(url);
        const target = repoPath(href, file);
        const named = /^[\w./-]+\.md$/.test(text) && target ? titles.get(target.path) : undefined;
        const inner = named ? escapeAttr(named) : this.parser.parseInline(tokens);
        return (
          `<a href="${escapeAttr(url)}"${title ? ` title="${escapeAttr(title)}"` : ""}` +
          `${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inner}</a>`
        );
      },
    },
  });

  // Wide tables scroll inside their own box on phones instead of widening the page.
  const html = (marked.parse(markdown, { async: false }) as string)
    .replace(/<table>/g, '<div class="spec-table"><table>')
    .replace(/<\/table>/g, "</table></div>");

  // Only a data source counts ("(IPEDS ADM)"), not a subtitle like "(Ingestion Agent)".
  const match = heading.match(/^(.*?)\s*\(((?:IPEDS|Scorecard|CDS)[^()]*)\)$/);
  return { title: match ? match[1] : heading, source: match ? match[2] : null, html, toc };
}
