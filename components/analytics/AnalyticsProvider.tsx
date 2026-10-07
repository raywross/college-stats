"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useMe } from "@/components/account/useMe";
import {
  hasAnalyticsSink,
  identify,
  installAnalyticsSink,
  navigationSourceFromPath,
  resetIdentity,
  roadmapSlugFromPath,
  takeNextViewFrom,
  track,
  unitIdFromPath,
  type AnalyticsSink,
} from "@/lib/analytics";

/**
 * Loads posthog-js and connects it to lib/analytics.ts (specs/product/telemetry.md "Architecture"). Rendered once in
 * app/layout.tsx (and in app/global-error.tsx, which replaces the layout). Renders nothing.
 *
 * Without NEXT_PUBLIC_POSTHOG_KEY, or when the browser sends Global Privacy Control or Do Not Track, nothing is
 * loaded and nothing is sent. Otherwise: page views on every pathname change (not query changes), `school_viewed` and
 * `roadmap_viewed` from the path, and the signed-in account's opaque id. The only file that may import posthog-js.
 */

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
  interface Window {
    doNotTrack?: string | null;
  }
}

/** The project key when analytics may run in this browser, else null. */
function allowedKey(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return null;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1") return null;
  return key;
}

/** Calls made before posthog-js has loaded wait here (capped) and replay in order once it has. */
const MAX_QUEUED = 200;
let queued: ((sink: AnalyticsSink) => void)[] = [];
const enqueue = (call: (sink: AnalyticsSink) => void) => {
  if (queued.length < MAX_QUEUED) queued.push(call);
};
const queueingSink: AnalyticsSink = {
  capture: (event, properties) => enqueue((s) => s.capture(event, properties)),
  identify: (distinctId) => enqueue((s) => s.identify(distinctId)),
  reset: () => enqueue((s) => s.reset()),
};

/** The sink this module installed (the provider sends `$pageview` to it directly: it isn't a registry event). */
let active: AnalyticsSink | null = null;
function setActive(sink: AnalyticsSink | null) {
  active = sink;
  installAnalyticsSink(sink);
}

let loading: Promise<AnalyticsSink | null> | null = null;
/** Imports and initializes posthog-js once per page load; null if it fails to load. */
function loadPostHog(key: string): Promise<AnalyticsSink | null> {
  loading ??= import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        // Cookieless: no cookie or localStorage id; a visit is one session (the spec's "Privacy").
        persistence: "memory",
        // Only registered events: no autocapture, replay, surveys, heatmaps, or remote config that could turn them on.
        autocapture: false,
        rageclick: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_pageview: false,
        capture_pageleave: true,
        disable_session_recording: true,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        advanced_disable_flags: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
        person_profiles: "identified_only",
      });
      const sink: AnalyticsSink = {
        capture: (event, properties) => {
          posthog.capture(event, properties);
        },
        identify: (distinctId) => {
          posthog.identify(distinctId);
          // A signed-in person's events carry no location at all (the spec's Decisions, 4).
          posthog.register({ $geoip_disable: true });
        },
        reset: () => posthog.reset(),
      };
      return sink;
    })
    .catch(() => null);
  return loading;
}

// Queue from the first moment this module runs in the browser, so events fired by components that mount before the
// provider (its effects run after theirs) aren't lost.
if (allowedKey()) setActive(queueingSink);

/** The last pathname counted as a page view; module-level so a remounted provider (global-error) doesn't recount. */
let lastPath: string | null = null;

export function AnalyticsProvider() {
  const pathname = usePathname();
  const me = useMe();
  const signedIn = me?.signedIn ?? null;
  const accountId = me?.id ?? null;
  const identified = useRef<string | null>(null);

  useEffect(() => {
    const key = allowedKey();
    if (!key) return;
    let cancelled = false;
    if (!hasAnalyticsSink()) setActive(queueingSink);
    loadPostHog(key).then((sink) => {
      if (cancelled) return;
      const calls = queued;
      queued = [];
      setActive(sink);
      if (!sink) return;
      for (const call of calls) {
        try {
          call(sink);
        } catch {
          // A failed replay drops that one event.
        }
      }
    });
    return () => {
      cancelled = true;
      setActive(null);
    };
  }, []);

  useEffect(() => {
    if (pathname === lastPath) return;
    const previous = lastPath;
    lastPath = pathname;
    // Taken on every page view, so a mark whose navigation went elsewhere can't attribute a later one.
    const marked = takeNextViewFrom();
    if (!active) return;
    try {
      active.capture("$pageview", { $current_url: window.location.href });
    } catch {
      // Never let analytics break navigation.
    }
    const unitId = unitIdFromPath(pathname);
    // Moving between topic pages of the same college is not a new view.
    if (unitId && unitId !== (previous && unitIdFromPath(previous))) {
      track("school_viewed", { unit_id: unitId, from: marked ?? navigationSourceFromPath(previous) });
    }
    const slug = roadmapSlugFromPath(pathname);
    if (slug) track("roadmap_viewed", { slug });
  }, [pathname]);

  useEffect(() => {
    if (signedIn && accountId) {
      if (identified.current !== accountId) {
        identify(accountId);
        identified.current = accountId;
      }
    } else if (signedIn === false && identified.current) {
      resetIdentity();
      identified.current = null;
    }
  }, [signedIn, accountId]);

  return null;
}
