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
      // High school shards, read when HIGH_SCHOOLS_SOURCE is json (CI, a keyless Preview; lib/high-schools.ts).
      "./data/high-schools/**/*.json",
      // Names, sites, and logos of the campus directories' organizations (lib/organizations.ts).
      "./data/directories/organizations.json",
      // ZIP code centers for the distance-from-home filter (lib/zip-centroids.ts).
      "./data/reference/zcta-centroids.csv",
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
      // Following became the Updates switch on each college on your list (specs/product/household-hub.md "What
      // goes"); /me/list sends the person on to their own list. Not permanent: /me/list's own target may move.
      { source: "/me/following", destination: "/me/list", permanent: false },
    ];
  },
  async rewrites() {
    return posthogRewrites(posthogHost);
  },
};

export default nextConfig;
