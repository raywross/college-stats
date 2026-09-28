import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // With DATA_SOURCE=json (the default), lib/data.ts reads the dataset and its source metadata with fs at
  // runtime, so make sure it ships with every server route when deployed (e.g. to Vercel).
  outputFileTracingIncludes: {
    "/*": ["./data/*.json"],
  },
  // /sources grew into the Data tab (specs/data-page.md).
  async redirects() {
    return [{ source: "/sources", destination: "/data", permanent: true }];
  },
};

export default nextConfig;
