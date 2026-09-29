import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { roadmapPages } from "./roadmap";
import { renderSpec, specHeading, type RenderedSpec } from "./roadmap-render";

// A literal "specs" segment keeps the bundler's file tracing to that folder instead of the whole project.
const readSpec = (file: string) => readFileSync(join(process.cwd(), "specs", file.replace(/^specs\//, "")), "utf8");

/** Titles of every roadmap page by repo path, so file-name links read as titles. */
const getTitles = cache(() => {
  const titles = new Map<string, string>();
  for (const { file } of roadmapPages()) {
    const heading = specHeading(readSpec(file));
    if (heading) titles.set(file, heading);
  }
  return titles;
});

/** A roadmap page's rendered spec, read from specs/ (at build time: the /roadmap pages are fully static). */
export const getRoadmapDoc = cache((slug: string): (RenderedSpec & { file: string }) | null => {
  const page = roadmapPages().find((p) => p.slug === slug);
  if (!page) return null;
  return { ...renderSpec(readSpec(page.file), page.file, getTitles()), file: page.file };
});
