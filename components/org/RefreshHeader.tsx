"use client";

import { useEffect } from "react";
import { refreshMe, useMe } from "@/components/account/useMe";

/**
 * The header remembers its last `/api/me` answer for five minutes (components/account/useMe.ts), so the pages where
 * that answer changes ask again on arrival. `/org` is where every change of membership lands (starting an
 * organization, joining one as a counselor, leaving, deleting): Caseload shows the moment an organization exists, and
 * goes the moment it doesn't. `/household` is where someone becomes a guardian or adds a child: the role item becomes
 * Household, and its menu lists the new child (specs/product/role-nav.md). Renders nothing.
 *
 * `org` (on /org): what the page knows about the organization. The header is asked again only once it has an answer
 * that disagrees (`me.org !== org`): a plain caseload visit, whose header already says Caseload, makes no `/api/me`
 * call. With no answer yet, useMe's own first request brings the current state. Without `org` (/household), it asks
 * on every arrival.
 */
export function RefreshHeader({ org }: { org?: boolean } = {}) {
  const me = useMe();
  const stale = org === undefined || (me !== null && me.signedIn && me.org !== org);
  useEffect(() => {
    if (stale) refreshMe();
  }, [stale]);
  return null;
}
