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
 * fixed for the life of the deploy: the bundled copy's id when `.data/snapshot/` exists and no DATA_SNAPSHOT_URL is
 * set (0 for the mini fixture). With DATA_SNAPSHOT_URL the served snapshot changes at run time, so a header written
 * here would go stale: none is set, and pages carry the id in their `<meta name="x-quad-snapshot">` (app/layout.tsx)
 * and /search-index.json in its own header. With neither there is no dataset to name: no header. Read when the
 * config loads (`next build`, `next dev`), after the prebuild's fetch-snapshot.
 */
export function deploySnapshotHeader(env: Record<string, string | undefined> = process.env, root = process.cwd()): string | null {
  if (env.DATA_SNAPSHOT_URL?.trim()) return null;
  const manifest = join(root, ".data", "snapshot", "manifest.json");
  if (!existsSync(manifest)) return null;
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
  // The deploy carries the dataset (specs/serving-architecture.md): lib/ reads the bundled copy with fs at runtime, so it
  // ships with every server route when deployed (e.g. to Vercel). tests/tracing.test.mts checks this list against lib/.
  outputFileTracingIncludes: {
    "/*": [
      // The bundled copy (specs/data-platform/publish.md "The loader"): what `npm run fetch-snapshot` writes at build
      // time (the mini fixture when nothing is configured) and lib/ reads: the dataset, history, detail and trend
      // shards (lib/data-platform/loader.ts), the reference documents read at run time (lib/organizations.ts,
      // lib/zip-centroids.ts, lib/essays/guidance.ts), and the high-school fallback (lib/high-school-store.ts).
      // Ignored by version control, so absent from a checkout until `fetch-snapshot` runs.
      "./.data/snapshot/**",
    ],
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
