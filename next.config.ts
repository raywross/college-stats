import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // With DATA_SOURCE=json (the default), lib/data.ts reads the dataset and its source metadata with fs at
  // runtime, so make sure it ships with every server route when deployed (e.g. to Vercel).
  outputFileTracingIncludes: {
    // organizations.json: names, sites, and logos of the campus directories' organizations (lib/organizations.ts).
    "/*": ["./data/*.json", "./data/history/**/*.json", "./data/detail/**/*.json", "./data/directories/organizations.json"],
    // /roadmap pages are prerendered from specs/*.md; ship the specs too in case a page is ever rendered on demand.
    "/roadmap/*": ["./specs/**/*.md"],
    // Same for /release-notes, prerendered from release-notes/*.md.
    "/release-notes": ["./release-notes/*.md"],
    "/release-notes/*": ["./release-notes/*.md"],
  },
  // /sources grew into the Data tab (specs/data-page.md).
  async redirects() {
    return [{ source: "/sources", destination: "/data", permanent: true }];
  },
};

export default nextConfig;
