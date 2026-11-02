import type { ComponentType } from "react";
import { Briefcase, UserRound, Users } from "lucide-react";
import { CASELOAD_HREF } from "@/lib/org-hrefs";

export interface AccountMenuLink {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Links in the avatar menu, in order, then Sign out: Household · Your account (specs/product/household-hub.md). Each
 * person's list and numbers are on their page, reached from the household; account features link from there or from
 * /account, never from the main navigation (specs/product/accounts.md).
 */
export const ACCOUNT_MENU_LINKS: AccountMenuLink[] = [
  { href: "/household", label: "Household", icon: Users },
  { href: "/account", label: "Your account", icon: UserRound },
];

/** Caseload, first, for a member of a counselor organization (specs/product/counselor-portal.md "The counselor's pages"). */
export const CASELOAD_LINK: AccountMenuLink = { href: CASELOAD_HREF, label: "Caseload", icon: Briefcase };

/** The menu's links for this person: Caseload only for members of an organization (`/api/me`'s `org`). */
export function accountMenuLinks(me: { org?: boolean }): AccountMenuLink[] {
  return me.org ? [CASELOAD_LINK, ...ACCOUNT_MENU_LINKS] : ACCOUNT_MENU_LINKS;
}
