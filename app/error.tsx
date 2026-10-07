"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/layout/Logo";
import { ErrorTracker } from "@/components/analytics/ErrorTracker";

/** The error page for anything below the root layout (app/global-error.tsx covers the layout itself). */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <ErrorTracker kind="error" />
      <LogoMark className="size-16" />
      <h1 className="mt-6 font-display text-5xl font-extrabold tracking-tight">
        Something <span className="highlight">broke</span>
      </h1>
      <p className="mt-3 text-muted-foreground">
        This page hit a problem on our end. Trying again usually works; if it doesn&apos;t, head home and come back in a
        bit.
      </p>
      <div className="mt-8 flex gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Try again
        </button>
        <Link href="/" className="rounded-full border px-5 py-2.5 text-sm font-semibold">
          Home
        </Link>
      </div>
    </div>
  );
}
