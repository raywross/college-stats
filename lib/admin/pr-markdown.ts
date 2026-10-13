/**
 * A pull request body as HTML for the Open data PRs list. The body is written by a workflow or by the console, but the
 * repository is public and a pull request's text is whatever its author typed, so it is rendered as untrusted:
 * raw HTML in the markdown is shown as text (never as markup), images become links (nothing loads from another host
 * while an admin reads), and links are kept only when they are http(s), opening in a new tab without a referrer.
 */
import { Marked } from "marked";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const safeUrl = (href: string) => (/^https?:\/\//i.test(href.trim()) ? href.trim() : null);

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>` : inner;
    },
    image({ href, text }) {
      const url = safeUrl(href);
      const label = escapeHtml(text || "image");
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>` : label;
    },
  },
});

/** The markdown as safe HTML. Tables scroll inside their own box on phones. */
export function renderPullBody(markdown: string): string {
  const html = marked.parse(markdown.slice(0, 60_000), { async: false }) as string;
  return html.replace(/<table>/g, '<div class="spec-table"><table>').replace(/<\/table>/g, "</table></div>");
}
