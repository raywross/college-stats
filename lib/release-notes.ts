/**
 * Release notes (/release-notes, specs/release-notes.md): one markdown file per merged PR in release-notes/, with a
 * small frontmatter block. Pure, so tests and the CI check (scripts/check-release-note.mts) can use it.
 */

export type ReleaseKind = "feature" | "improvement" | "data" | "fix" | "plans" | "infra";

/** In the order the index legend lists them. `dot` is a Tailwind background class from the design tokens. */
export const RELEASE_KINDS: Record<ReleaseKind, { label: string; description: string; dot: string }> = {
  feature: { label: "New feature", description: "Something new to see or do on the site", dot: "bg-d-admissions" },
  improvement: { label: "Improvement", description: "A better version of something already there", dot: "bg-d-scores" },
  data: { label: "Data", description: "Newer or more data behind the numbers", dot: "bg-d-access" },
  fix: { label: "Fix", description: "Something that was wrong, now right", dot: "bg-d-size" },
  plans: { label: "Plans", description: "New specs for work that's coming", dot: "bg-d-value" },
  infra: { label: "Behind the scenes", description: "How the site is built, checked, and deployed", dot: "bg-muted-foreground" },
};

export interface ReleaseNote {
  /** URL segment: /release-notes/{slug}; the file name without .md. */
  slug: string;
  /** Repo-relative path. */
  file: string;
  title: string;
  /** The GitHub pull request number. */
  pr: number;
  /** YYYY-MM-DD, the day it merged. */
  date: string;
  kind: ReleaseKind;
  /** One plain-language sentence for the index. */
  summary: string;
  /** The markdown after the frontmatter. */
  body: string;
}

export const RELEASE_NOTES_DIR = "release-notes";

/**
 * Parses a note's file. Throws with the file name and the problem, so a bad note fails the tests, the build, and the
 * CI check with a message that says what to fix.
 */
export function parseReleaseNote(file: string, text: string): ReleaseNote {
  const fail = (problem: string): never => {
    throw new Error(`${file}: ${problem}`);
  };
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) fail("must start with a --- frontmatter block");
  const [, head, body] = match!;

  const fields = new Map<string, string>();
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (!kv) fail(`can't read frontmatter line "${line}"`);
    fields.set(kv![1], kv![2].trim().replace(/^"(.*)"$/, "$1"));
  }
  const need = (key: string) => fields.get(key) || fail(`missing "${key}"`);

  const slug = file.split("/").pop()!.replace(/\.md$/, "");
  if (!/^[a-z0-9-]+$/.test(slug)) fail("file name must be lowercase letters, digits, and hyphens");
  const pr = Number(need("pr"));
  if (!Number.isInteger(pr) || pr <= 0) fail(`"pr" must be a PR number`);
  const date = need("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail(`"date" must be YYYY-MM-DD`);
  const kind = need("kind");
  if (!(kind in RELEASE_KINDS)) fail(`"kind" must be one of ${Object.keys(RELEASE_KINDS).join(", ")}`);
  if (/^#\s/m.test(body)) fail("no # heading in the body: the page shows the title from the frontmatter");
  if (!body.trim()) fail("body is empty");
  const known = new Set(["title", "pr", "date", "kind", "summary"]);
  for (const key of fields.keys()) if (!known.has(key)) fail(`unknown frontmatter key "${key}"`);

  return { slug, file, title: need("title"), pr, date, kind: kind as ReleaseKind, summary: need("summary"), body };
}

/**
 * Links from one note to another ("[next release](loan-rate-history.md)") become /release-notes pages; the renderer
 * leaves site-absolute links alone and sends other repo links to GitHub or the roadmap.
 */
export function linkReleaseNotes(body: string): string {
  return body.replace(/\]\(([a-z0-9-]+)\.md(#[^)]*)?\)/g, (_, slug: string, hash = "") => `](/release-notes/${slug}${hash})`);
}

/**
 * The pull-request check (scripts/check-release-note.mts): among the note files a PR adds or changes, one must parse
 * and name this PR. Returns the problem to report, or null when the PR has its note.
 */
export function releaseNoteProblem(pr: number, changed: { file: string; text: string }[]): string | null {
  const notes: ReleaseNote[] = [];
  for (const { file, text } of changed) {
    try {
      notes.push(parseReleaseNote(file, text));
    } catch (error) {
      return (error as Error).message;
    }
  }
  if (notes.some((n) => n.pr === pr)) return null;
  const found = notes.map((n) => `${n.file} (pr: ${n.pr})`).join(", ");
  return (
    `PR #${pr} has no release note. Add ${RELEASE_NOTES_DIR}/<slug>.md with "pr: ${pr}" ` +
    `(see specs/release-notes.md).${found ? ` Changed notes: ${found}.` : ""}`
  );
}

/** Newest first: by date, then by PR number. */
export function sortReleaseNotes(notes: ReleaseNote[]): ReleaseNote[] {
  return [...notes].sort((a, b) => b.date.localeCompare(a.date) || b.pr - a.pr);
}

/** "September 29, 2026", without the time zone shifting the day. */
export function formatReleaseDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
