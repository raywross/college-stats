import type { ComponentType } from "react";
import { ShieldCheck, UserRound, Users } from "lucide-react";
import type { MeRole } from "@/lib/accounts";

export interface AccountMenuLink {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Links in the avatar menu, in order, then Sign out (specs/product/role-nav.md "The avatar menu"): the personal
 * things. Household stays here for a student (it is how they invite a parent); a guardian's Household and a
 * counselor's Caseload moved to the header's role item (components/layout/role-nav.ts). Each person's list and
 * numbers are on their page, reached from the household; account features link from there or from /account, never
 * from the main navigation (specs/product/accounts.md).
 */
export const HOUSEHOLD_LINK: AccountMenuLink = { href: "/household", label: "Household", icon: Users };
export const ACCOUNT_LINK: AccountMenuLink = { href: "/account", label: "Your account", icon: UserRound };

/**
 * Admin, last, for an admin (specs/product/admin.md "The console"): the way into the console, so an admin never types
 * the address. The console is still a 404 to anyone else, and asks an admin for the second factor itself.
 */
export const ADMIN_LINK: AccountMenuLink = { href: "/admin", label: "Admin", icon: ShieldCheck };

/** The menu's links for this person: Household for a student only, Admin for an admin only (`/api/me`). */
export function accountMenuLinks(me: { admin?: boolean; role?: MeRole | null }): AccountMenuLink[] {
  const student = !me.role || me.role === "student";
  return [...(student ? [HOUSEHOLD_LINK] : []), ACCOUNT_LINK, ...(me.admin ? [ADMIN_LINK] : [])];
}
