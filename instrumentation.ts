import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

function missingConfiguration(variable: "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN" | "NEXT_PUBLIC_POSTHOG_HOST") {
  if (process.env.NODE_ENV === "development") {
    throw new Error(
      `${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
    );
  }
  return null;
}

export const posthogLoggerProvider = !projectToken
  ? missingConfiguration("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN")
  : !host
    ? missingConfiguration("NEXT_PUBLIC_POSTHOG_HOST")
    : new LoggerProvider({
        resource: resourceFromAttributes({ "service.name": "college-stats" }),
        processors: [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({
              url: `${host}/i/v1/logs`,
              headers: {
                Authorization: `Bearer ${projectToken}`,
                "Content-Type": "application/json",
              },
            }),
          }),
        ],
      });

// This provider is intentionally not global: only the dedicated logger below exports lines added by this integration.
export const posthogLogger = posthogLoggerProvider?.getLogger("college-stats-posthog");

export function register() {
  // Next.js loads this module for the Node runtime; route handlers use the dedicated logger directly.
}
