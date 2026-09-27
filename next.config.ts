import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/data.ts reads the dataset with fs at runtime, so make sure it ships
  // with every server route when deployed (e.g. to Vercel).
  outputFileTracingIncludes: {
    "/*": ["./data/schools.json"],
  },
};

export default nextConfig;
