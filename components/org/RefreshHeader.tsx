"use client";

import { useEffect } from "react";
import { refreshMe } from "@/components/account/useMe";

/**
 * The header remembers its last `/api/me` answer for five minutes (components/account/useMe.ts), so the pages where
 * that answer changes ask again on arrival. `/org` is where every change of membership lands (starting an
 * organization, joining one as a counselor, leaving, deleting): Caseload shows the moment an organization exists, and
 * goes the moment it doesn't. `/household` is where someone becomes a guardian or adds a child: the role item becomes
 * Household, and its menu lists the new child (specs/product/role-nav.md). Renders nothing.
 */
export function RefreshHeader() {
  useEffect(() => {
    refreshMe();
  }, []);
  return null;
}
