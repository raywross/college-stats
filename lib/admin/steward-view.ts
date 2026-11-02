/**
 * How the Data Steward's screens read (specs/product/data-steward.md "The console: where it all shows"): the links
 * between them, a document opened at its page, the To do words, and the URL parameters. Pure, so the pages and
 * components share it and tests/admin-steward.test.mts pins it.
 */
import type { TodoDoc, TodoStatus } from "../steward/types.ts";

export const linkCls = "underline decoration-dotted underline-offset-2";

/** The college's Review page. */
export const reviewHref = (unit: string) => `/admin/colleges/${unit}/review`;
/** A proposal's page. */
export const proposalHref = (key: string) => `/admin/data/proposals/${encodeURIComponent(key)}`;

/** A document's address opened at a page (PDF viewers read `#page=`), or null for anything but http(s). */
export function documentHref(url: string | null | undefined, page?: number | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return page ? `${url.replace(/#.*$/, "")}#page=${page}` : url;
}

/** "12.5%" for a rate between 0 and 1. */
export const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

export const TODO_STATUS_LABEL: Record<TodoStatus, string> = { open: "Open", found: "Found", "no-document": "No document published", done: "Done" };
export const TODO_KIND_LABEL: Record<TodoDoc["kind"], string> = {
  cds: "Common Data Set",
  "class-profile": "Class profile",
  "campus-page": "Campus page",
  "hs-profile": "High school profile",
  other: "Other",
};
export const TODO_WHY_LABEL: Record<TodoDoc["why"], string> = {
  "robots-path": "robots.txt disallows the path",
  "robots-host": "robots.txt disallows the site",
  challenge: "a bot challenge",
  "bot-check": "a bot check",
  viewer: "a document viewer",
  "js-only": "built by JavaScript",
  terms: "the terms forbid it",
  login: "behind a login",
  "not-found": "the link is gone",
  "no-document": "no document found",
  unknown: "not recorded",
};

/** A key from a URL segment: decoded once when it decodes, else as given. */
export function keyFromSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A page number from `?page=`: a positive integer, else 1. */
export function pageParam(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** One `?name=` value as a trimmed string, or null. */
export function param(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The CDS edition a Steward document names (a finding, a row, a To do row), or null: the screens show it as written. */
export function editionOf(doc: { edition?: string | null }): string | null {
  return doc.edition ?? null;
}
