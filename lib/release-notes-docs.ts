import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { linkReleaseNotes, parseReleaseNote, sortReleaseNotes, type ReleaseNote } from "./release-notes";
import { renderSpec, type RenderedSpec } from "./roadmap-render";

// A literal "release-notes" segment keeps the bundler's file tracing to that folder instead of the whole project.
const dir = () => join(process.cwd(), "release-notes");

/** Every release note, newest first (read at build time: the /release-notes pages are fully static). */
export const getReleaseNotes = cache((): ReleaseNote[] =>
  sortReleaseNotes(
    readdirSync(dir())
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .map((name) => parseReleaseNote(`release-notes/${name}`, readFileSync(join(dir(), name), "utf8"))),
  ),
);

/** One note with its body rendered (links to specs become roadmap pages or GitHub links, as on /roadmap). */
export const getReleaseNote = cache((slug: string): (ReleaseNote & Pick<RenderedSpec, "html" | "toc">) | null => {
  const note = getReleaseNotes().find((n) => n.slug === slug);
  if (!note) return null;
  const { html, toc } = renderSpec(linkReleaseNotes(note.body), note.file);
  return { ...note, html, toc };
});
