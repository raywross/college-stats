import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * PostHog behind a same-origin path (specs/product/telemetry.md "Privacy"): the browser sends events to /ingest/*,
 * so ordinary blocking doesn't silently blank the numbers. Static assets come from the region's asset host
 * (us.i.posthog.com → us-assets.i.posthog.com). The host is read at build time.
 */
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export function posthogAssetHostFor(host: string): string {
  return host.replace(/:\/\/([a-z]+)\.i\.posthog\.com/, "://$1-assets.i.posthog.com");
}

export const posthogAssetHost = posthogAssetHostFor(posthogHost);

/** The /ingest rewrites for an ingestion host; static first, since /ingest/:path* would also match it. */
export function posthogRewrites(host: string) {
  const base = host.replace(/\/+$/, "");
  return [
    { source: "/ingest/static/:path*", destination: `${posthogAssetHostFor(base)}/static/:path*` },
    { source: "/ingest/:path*", destination: `${base}/:path*` },
  ];
}

/**
 * The `x-quad-snapshot` response header (specs/data-platform/publish.md "Timing and telemetry") where the snapshot is
 * fixed for the life of the deploy: `legacy` when the dataset comes from data/, the bundled copy's id when
 * `.data/snapshot/` exists and no DATA_SNAPSHOT_URL is set. With DATA_SNAPSHOT_URL the served snapshot changes at run
 * time, so a header written here would go stale: none is set, and pages carry the id in their
 * `<meta name="x-quad-snapshot">` (app/layout.tsx) and /search-index.json in its own header. Read when the config
 * loads (`next build`, `next dev`), after the prebuild's fetch-snapshot.
 */
export function deploySnapshotHeader(env: Record<string, string | undefined> = process.env, root = process.cwd()): string | null {
  if (env.DATA_SNAPSHOT_URL?.trim()) return null;
  const manifest = join(root, ".data", "snapshot", "manifest.json");
  if (!existsSync(manifest)) return "legacy";
  return String((JSON.parse(readFileSync(manifest, "utf8")) as { id: number }).id);
}

const nextConfig: NextConfig = {
  // PostHog's API paths end in a slash (/e/, /flags/); a redirect to strip it would break the /ingest proxy.
  skipTrailingSlashRedirect: true,
  experimental: {
    // A shared award letter (a PDF or a phone photo, at most 4 MB: lib/planner/store-offers.ts shareLetter) goes
    // through a Server Action as multipart form data; the default 1 MB limit is too small for a photo. Kept under
    // Vercel's 4.5 MB request cap.
    serverActions: { bodySizeLimit: "4.4mb" },
  },
  // The deploy carries the dataset (specs/serving-architecture.md): lib/ reads these files with fs at runtime, so they
  // ship with every server route when deployed (e.g. to Vercel). List exactly what the runtime reads and nothing else
  // (working files such as data/site-probe.json stay out); tests/tracing.test.mts checks this list against lib/.
  outputFileTracingIncludes: {
    "/*": [
      // The college dataset, its source metadata, release calendar, and short names (lib/data.ts getData()).
      "./data/schools.json",
      "./data/meta.json",
      "./data/release-calendar.json",
      "./data/aliases.json",
      // History, national trend files, and per-college detail tables, read per page (lib/data.ts).
      "./data/history/**/*.json",
      "./data/detail/**/*.json",
      // "This season on the Common App" (lib/data.ts getCommonAppTrends()), the hand-reviewed national figures.
      "./data/trends/common-app.json",
      // The application platforms' essay prompts (lib/data.ts getPlatformPrompts(), the essays workspace).
      "./data/reference/platform-prompts.json",
      // The reader's guidance corpus (lib/essays/guidance.ts loadGuidance(), POST /api/essays/review).
      "./data/reference/essay-guidance/guidance.md",
      // High school shards, read when HIGH_SCHOOLS_SOURCE is json (CI, a keyless Preview; lib/high-schools.ts).
      "./data/high-schools/**/*.json",
      // Names, sites, and logos of the campus directories' organizations (lib/organizations.ts).
      "./data/directories/organizations.json",
      // ZIP code centers for the distance-from-home filter (lib/zip-centroids.ts).
      "./data/reference/zcta-centroids.csv",
      // The bundled snapshot (specs/data-platform/publish.md "The loader"): what `npm run fetch-snapshot` writes at
      // build time and lib/data-platform/loader.ts reads. Ignored by version control, so absent from a checkout; the
      // data/ entries above stay until phase 2 (specs/data-platform/rollout.md).
      "./.data/snapshot/**",
    ],
    // The admin console's data health (lib/admin/health.ts; specs/product/admin.md "Files the deploy must carry") reads
    // one compact file, which `npm run college-health` builds in each data PR from the college-reported documents,
    // records, failures, review queue, and link findings (42 MB together, so they are not traced). Only /admin routes.
    "/admin/**": ["./data/college-health.json"],
    // /roadmap pages are prerendered from specs/*.md; ship the specs too in case a page is ever rendered on demand.
    "/roadmap/*": ["./specs/**/*.md"],
    // Same for /release-notes, prerendered from release-notes/*.md.
    "/release-notes": ["./release-notes/*.md"],
    "/release-notes/*": ["./release-notes/*.md"],
  },
  async redirects() {
    return [
      // /sources grew into the Data tab (specs/data-page.md).
      { source: "/sources", destination: "/data", permanent: true },
      // The event calendar moved from `?view=events` on the overview to its own route, so the overview stays
      // prerendered (specs/product/visit-events.md "Display"); older links (emails, bookmarks) still land on it.
      { source: "/schools/:id", has: [{ type: "query", key: "view", value: "events" }], destination: "/schools/:id/events", permanent: false },
      // Following became the Updates switch on each college on your list (specs/product/household-hub.md "What
      // goes"); /me/list sends the person on to their own list. Not permanent: /me/list's own target may move.
      { source: "/me/following", destination: "/me/list", permanent: false },
      // The plan became Quad Advisor (specs/product/advisor.md "1. The name", "How the rename is built"): the page tree
      // moved from /plan to /advisor. Permanent, for good: emails, texts, and calendar feeds already carry /plan links.
      // The query string passes through (`/plan?for=…&tab=calendar` → `/advisor?for=…&tab=calendar`); /api/plan/*
      // is a different path and stays.
      { source: "/plan", destination: "/advisor", permanent: true },
      { source: "/plan/:path*", destination: "/advisor/:path*", permanent: true },
      // The essay workspace's list became the Essays tab (specs/product/essays/tab.md "The tab strip"). A real 308 here;
      // the page's own redirect (app/advisor/essays/page.tsx) stays for a `?college=` link, which needs the card anchor
      // the config can't write. The query string passes through (`?for=`).
      { source: "/advisor/essays", missing: [{ type: "query", key: "college" }], destination: "/advisor?tab=essays", permanent: true },
    ];
  },
  async headers() {
    const snapshot = deploySnapshotHeader();
    // Every route but Next's own static files, which carry no data.
    return snapshot === null ? [] : [{ source: "/((?!_next/).*)", headers: [{ key: "x-quad-snapshot", value: snapshot }] }];
  },
  async rewrites() {
    return posthogRewrites(posthogHost);
  },
};

export default nextConfig;
