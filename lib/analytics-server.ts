import "server-only";
import { PostHog } from "posthog-node";
import { sanitizeProperties } from "./analytics.ts";
import type { AnalyticsEvents, ServerAnalyticsEvent } from "./analytics.ts";

/**
 * Server-side events (specs/product/telemetry.md): sign-ups now, later subscriptions and API use. Sent from Server
 * Actions and Route Handlers with posthog-node, so ad blockers can't hide them. The only file besides
 * components/analytics/AnalyticsProvider.tsx that may import PostHog (tests/analytics.test.mts).
 */

let client: PostHog | null = null;

/** NEXT_PUBLIC_POSTHOG_KEY is set: events are sent. Unset (CI, previews, local work): every call is a no-op. */
export function analyticsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

function getClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  // flushAt 1 / flushInterval 0: serverless functions end right after the response, so nothing may wait in a batch.
  client ??= new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/**
 * Sends a registered server event and resolves once it's delivered. Never throws; no-op without a key. Anonymous when
 * `distinctId` is omitted (a fresh random id with no person profile); pass the new account's `auth.users.id` to link
 * the event to it.
 */
export async function trackServer<K extends ServerAnalyticsEvent>(
  event: K,
  properties: AnalyticsEvents[K],
  distinctId?: string,
): Promise<void> {
  try {
    const posthog = getClient();
    if (!posthog) return;
    const clean = sanitizeProperties(event, properties);
    if (!clean) return;
    await posthog.captureImmediate({
      distinctId: distinctId ?? crypto.randomUUID(),
      event,
      properties: distinctId ? clean : { ...clean, $process_person_profile: false },
    });
  } catch (error) {
    console.warn(`analytics: trackServer(${event}) failed`, error);
  }
}
