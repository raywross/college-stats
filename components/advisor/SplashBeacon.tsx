"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/** Records one view of the splash page (`advisor_page_viewed`), on mount. Renders nothing. */
export function SplashBeacon({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    track("advisor_page_viewed", { signed_in: signedIn });
  }, [signedIn]);
  return null;
}
