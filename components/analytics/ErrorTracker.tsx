"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics";

/** Reports that an error or not-found page was shown (`error_shown`), once per pathname. Renders nothing. */
export function ErrorTracker({ kind }: { kind: "error" | "not_found" }) {
  const pathname = usePathname();
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (reported.current === pathname) return;
    reported.current = pathname;
    track("error_shown", { route: pathname, kind });
  }, [pathname, kind]);
  return null;
}
