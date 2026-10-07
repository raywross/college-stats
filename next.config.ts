import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // With DATA_SOURCE=json (the default), lib/data.ts reads the dataset and its source metadata with fs at
  // runtime, so make sure it ships with every server route when deployed (e.g. to Vercel).
  outputFileTracingIncludes: {
    // organizations.json: names, sites, and logos of the campus directories' organizations (lib/organizations.ts).
    // zcta-centroids.csv: ZIP code centers for the distance-from-home filter (lib/zip-centroids.ts).
    "/*": ["./data/*.json", "./data/history/**/*.json", "./data/detail/**/*.json", "./data/directories/organizations.json", "./data/reference/zcta-centroids.csv"],
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
};

export default nextConfig;
