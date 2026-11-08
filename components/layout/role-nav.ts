import type { ComponentType } from "react";
import { Briefcase, ListChecks, Settings2, UserPlus, Users } from "lucide-react";
import type { MeState } from "@/lib/accounts";
import { CASELOAD_HREF } from "@/lib/org-hrefs";
import { ADVISOR_PATH, ADVISOR_SHORT, advisorTitle } from "@/lib/planner/advisor";
import { planHref } from "@/lib/planner/plan-tabs";

type Icon = ComponentType<{ className?: string }>;

export interface RoleNavEntry {
  href: string;
  label: string;
  /** The phone's More sheet shows "page" entries only; a "child" entry (one student's advisor) is reached from the
   * advisor's own people line there. */
  kind: "child" | "page";
  icon: Icon;
  /** The one-line caption under the title in the More sheet. */
  sub: string;
}

/** The header's second item and the phone's middle tab, for one person (specs/product/role-nav.md). */
export interface RoleNav {
  label: string;
  /** Where one click (or tap) goes. */
  href: string;
  icon: Icon;
  /** Under the chevron on desktop, and (the pages) in the phone's More sheet. Empty: the item is a plain link. */
  menu: RoleNavEntry[];
  /** The path prefixes that light the item. */
  activePaths: string[];
}

const firstNameOf = (name: string | null) => name?.trim().split(/\s+/)[0] || null;

/** "Jordan's advisor", or "Their advisor" for a student whose name isn't in yet. */
export function childEntryLabel(name: string | null): string {
  const first = firstNameOf(name);
  return first ? advisorTitle(first) : "Their advisor";
}

/** The advisor, as before this item existed: signed out (the splash page), a student, and while the answer loads. */
const ADVISOR: RoleNav = { label: ADVISOR_SHORT, href: ADVISOR_PATH, icon: ListChecks, menu: [], activePaths: [ADVISOR_PATH] };

/**
 * The role item for this person (specs/product/role-nav.md "The item"):
 * - A student, a signed-out visitor, and an answer not yet in: **Advisor**, a plain link to `/advisor`.
 * - A guardian: **Household**. One click opens the advisor (the last child's, with the people line); the menu lists
 *   each child's advisor by name, then "Manage household". With no student on the roster yet, the click goes to the
 *   household page itself and the menu says "Add someone".
 * - A counselor: **Caseload**. One click opens `/org`; the menu has Add students and Members and settings, then, for a
 *   counselor who is also a parent, their children's advisors and Household.
 * Pure, so the header, the tab bar, and the tests share it.
 */
export function roleNav(me: Pick<MeState, "signedIn" | "role" | "children"> | null): RoleNav {
  if (!me || !me.signedIn || !me.role || me.role === "student") return ADVISOR;
  const children: RoleNavEntry[] = (me.children ?? []).map((c) => ({
    href: planHref({ person: c.id }),
    label: childEntryLabel(c.name),
    kind: "child",
    icon: ListChecks,
    sub: "Their colleges, next steps, and essays",
  }));
  if (me.role === "guardian") {
    const household: RoleNavEntry = children.length
      ? { href: "/household", label: "Manage household", kind: "page", icon: Users, sub: "Who's in it, add someone, home address" }
      : { href: "/household", label: "Add someone", kind: "page", icon: UserPlus, sub: "Start your household" };
    return { label: "Household", href: children.length ? ADVISOR_PATH : "/household", icon: Users, menu: [...children, household], activePaths: [ADVISOR_PATH, "/household"] };
  }
  const own: RoleNavEntry[] = children.length ? [...children, { href: "/household", label: "Household", kind: "page", icon: Users, sub: "Your own family" }] : [];
  return {
    label: "Caseload",
    href: CASELOAD_HREF,
    icon: Briefcase,
    menu: [
      { href: "/org/students/new", label: "Add students", kind: "page", icon: UserPlus, sub: "Invite students to your caseload" },
      { href: "/org/members", label: "Members and settings", kind: "page", icon: Settings2, sub: "Your organization" },
      ...own,
    ],
    activePaths: [CASELOAD_HREF, ADVISOR_PATH, "/household"],
  };
}
