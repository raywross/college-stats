import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

function warnMissing(variable: "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN" | "NEXT_PUBLIC_POSTHOG_HOST") {
  if (process.env.NODE_ENV === "development") {
    console.warn(`${variable} is not set, so PostHog is off and no events are sent. Add it to .env.local to turn it on.`);
  }
}

if (!projectToken) {
  warnMissing("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN");
} else if (!host) {
  warnMissing("NEXT_PUBLIC_POSTHOG_HOST");
} else {
  posthog.init(projectToken, {
    api_host: host,
    defaults: "2026-05-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
}
