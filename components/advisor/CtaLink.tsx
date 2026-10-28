"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { track } from "@/lib/analytics";

/** A splash-page link that records which section's button was tapped (`advisor_cta_tapped`, telemetry's one click event here). */
export function CtaLink({ href, section, className, children }: { href: string; section: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={className} onClick={() => track("advisor_cta_tapped", { section })}>
      {children}
    </Link>
  );
}
