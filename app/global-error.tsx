"use client";

import { Suspense, useEffect } from "react";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { ErrorTracker } from "@/components/analytics/ErrorTracker";

/**
 * Shown when the root layout itself fails. It replaces the layout, so it renders its own document without the global
 * styles: inline styles and system colors only (light or dark from the OS). It also mounts the analytics provider,
 * since the layout's copy is gone; the provider runs first so the error report has somewhere to go.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const button = {
    borderRadius: 9999,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    textDecoration: "none",
  } as const;

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          colorScheme: "light dark",
          background: "Canvas",
          color: "CanvasText",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <title>Something broke</title>
        <Suspense fallback={null}>
          <AnalyticsProvider />
        </Suspense>
        <ErrorTracker kind="error" />
        <main
          style={{
            maxWidth: 512,
            margin: "0 auto",
            padding: "96px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 44, fontWeight: 800, letterSpacing: "-0.02em" }}>Something broke</h1>
          <p style={{ marginTop: 12, opacity: 0.7, lineHeight: 1.5 }}>
            The site hit a problem on our end. Trying again usually works; if it doesn&apos;t, head home and come back in
            a bit.
          </p>
          <div style={{ marginTop: 32, display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{ ...button, border: "1px solid CanvasText", background: "CanvasText", color: "Canvas" }}
            >
              Try again
            </button>
            {/* A full page load, not a client navigation: the app's layout is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ ...button, border: "1px solid CanvasText", color: "CanvasText" }}>
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
