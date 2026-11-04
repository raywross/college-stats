"use client";

import { useEffect } from "react";
import { refreshMe } from "@/components/account/useMe";

/**
 * `/org` is where every change of membership lands (starting an organization, joining one as a counselor, leaving,
 * deleting), and the header remembers its last `/api/me` answer for five minutes (components/account/useMe.ts), so
 * this asks again on arrival: Caseload shows in the account menu the moment an organization exists, and goes the
 * moment it doesn't. Renders nothing.
 */
export function RefreshHeader() {
  useEffect(() => {
    refreshMe();
  }, []);
  return null;
}
