"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { markNotFound, track } from "@/lib/analytics";

/**
 * Reports that an error or not-found page was shown (`error_shown`), once per pathname. Renders nothing. A not-found
 * page also marks its path, so the provider (whose effect runs after this one: it sits later in the layout) doesn't
 * count `/schools/{unknown id}` as a college view.
 */
export function ErrorTracker({ kind }: { kind: "error" | "not_found" }) {
  const pathname = usePathname();
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (reported.current === pathname) return;
    reported.current = pathname;
    if (kind === "not_found") markNotFound(pathname);
    track("error_shown", { route: pathname, kind });
  }, [pathname, kind]);
  return null;
}
