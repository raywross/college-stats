/**
 * The guidance corpus as the reader receives it (specs/product/essays/reviewer.md "The guidance corpus"):
 * the reference document `essay-guidance/guidance` (the bundled copy's .data/snapshot/reference/essay-guidance.md), split by its `## ` headings, and the sections for a prompt's kind picked
 * for the system block. The thirteen headings below are the contract with the corpus (tests/essay-guidance.test.mts
 * checks the file has them); retrieval is by heading, not by embeddings (reviewer.md "A small language model, or a RAG").
 *
 * The file's preamble (its title and DRAFT line) and its last section, "Questions for the owner", are for the owner and
 * never reach the reader: `parseGuidance` keeps only the contract's headings, so a section the owner adds is ignored
 * until it is named here.
 *
 * `loadGuidance` reads the file from disk (traced in next.config.ts, listed in tests/tracing.test.mts); the rest is pure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EssayKind } from "./prompts.ts";

export const CRAFT_SECTIONS = ["mechanics", "prompt", "specific", "structure", "voice", "care", "showcase", "interest"] as const;
export const APPROACH_SECTIONS = [
  "approach: what to showcase",
  "approach: the main essay and the supplements",
  "approach: depth",
  "approach: showing interest",
  "approach: short answers",
] as const;
export type GuidanceHeading = (typeof CRAFT_SECTIONS)[number] | (typeof APPROACH_SECTIONS)[number];
/** Every heading the reader may receive, in the order the system block places them. */
export const GUIDANCE_HEADINGS: readonly GuidanceHeading[] = [...CRAFT_SECTIONS, ...APPROACH_SECTIONS];

/** The owner's section: never loaded, whatever the kind. */
export const OWNER_SECTION = "Questions for the owner";

export type GuidanceSections = Partial<Record<GuidanceHeading, string>>;

const isHeading = (h: string): h is GuidanceHeading => (GUIDANCE_HEADINGS as readonly string[]).includes(h);

/** The contract's sections of a guidance file, by heading (bodies trimmed). Anything else in the file is dropped. */
export function parseGuidance(markdown: string): GuidanceSections {
  const out: GuidanceSections = {};
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current !== null && isHeading(current)) {
      const body = lines.join("\n").trim();
      if (body) out[current] = body;
    }
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !line.startsWith("###")) {
      flush();
      current = m[1];
      lines = [];
    } else if (/^#\s/.test(line)) {
      flush();
      current = null;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return out;
}

/** The contract's headings a file lacks (empty when it has every one). */
export function missingSections(sections: GuidanceSections): GuidanceHeading[] {
  return GUIDANCE_HEADINGS.filter((h) => !sections[h]);
}

/**
 * The sections the reader gets for a prompt's kind (reviewer.md "How it reads" 3: "the guidance for this prompt's
 * kind and the categories"). Every kind gets the craft categories that apply to it; `interest` and "showing interest"
 * only for a "why us" or a program prompt; the short-answer section for short answers and activity prompts; the
 * essay-level approach (what to showcase, how the main essay and the supplements divide the work, depth) for essays.
 * One fixed list per kind, so the system block is the same bytes for every review of that kind and caches.
 */
export function sectionsFor(kind: EssayKind): GuidanceHeading[] {
  const craft: GuidanceHeading[] = ["mechanics", "prompt", "specific", "structure", "voice", "care", "showcase"];
  switch (kind) {
    case "why_us":
    case "program":
      return [...craft, "interest", "approach: showing interest", "approach: the main essay and the supplements"];
    case "short_answer":
    case "activity":
      return [...craft, "approach: short answers", "approach: depth"];
    default:
      // personal, essay, optional, other, free
      return [...craft, "approach: what to showcase", "approach: the main essay and the supplements", "approach: depth"];
  }
}

/** The guidance half of the system block for a kind: each picked section under its heading, in contract order. */
export function guidanceText(sections: GuidanceSections, kind: EssayKind): string {
  const picked = sectionsFor(kind);
  return GUIDANCE_HEADINGS.filter((h) => picked.includes(h) && sections[h])
    .map((h) => `### ${h}\n\n${sections[h]}`)
    .join("\n\n");
}

/** Every url the picked sections cite (a note's `source` must be one of them, else it is cleared). */
export function citedUrls(text: string): Set<string> {
  return new Set([...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]));
}

let cached: GuidanceSections | null = null;

/**
 * The corpus from disk, parsed once per server instance. Throws when the file is missing or lacks a contract heading:
 * the reader never runs on partial guidance.
 */
export function loadGuidance(): GuidanceSections {
  if (cached) return cached;
  const markdown = readFileSync(join(process.cwd(), ".data", "snapshot", "reference", "essay-guidance.md"), "utf8");
  const sections = parseGuidance(markdown);
  const missing = missingSections(sections);
  if (missing.length) throw new Error(`essay guidance lacks sections: ${missing.join(", ")}`);
  cached = sections;
  return sections;
}
