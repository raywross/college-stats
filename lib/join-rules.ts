/**
 * The join page's pure rules (specs/product/counselor-portal.md "How a student joins", "The student's side"): what
 * `/join/[code]` shows for a segment (a join code or a 64-hex invitation token), the previews, and who is looking,
 * plus the links in and out of it. No server or browser APIs, so the page, its Server Action, and tests share it.
 * The page (app/join/[code]/page.tsx) gathers the inputs; JoinView renders the state.
 */
import { loginHref, safeNextPath, type RoleHint } from "./accounts.ts";
import { ORG_ERRORS, formatJoinCode, isInvitationToken, joinHref, parseJoinCode, type OrgKind } from "./org-rules.ts";
import { FRESH_CONFIRMATION_MS, isFreshConfirmation } from "./signup-events-rules.ts";

/** What a segment is: an invitation token, a join code (stored form), or neither. */
export type JoinTarget = { kind: "invitation"; token: string } | { kind: "code"; code: string } | { kind: "invalid" };

/** Tells a 64-hex invitation token from a code ("QUAD-RIVERA", "rivera"); anything else is invalid. */
export function joinTarget(segment: string): JoinTarget {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    /* a stray % reads as typed */
  }
  if (isInvitationToken(s)) return { kind: "invitation", token: s };
  const code = parseJoinCode(s);
  return code ? { kind: "code", code } : { kind: "invalid" };
}

/** org_code_preview(): a code's organization (lib/orgs.ts CodePreview). */
export interface JoinCodePreview {
  org_name: string;
  org_kind: OrgKind;
  join_code: string;
  counselor_names: string[];
}

/** org_invitation_preview(): an invitation's organization and who sent it (lib/orgs.ts InvitationPreview). */
export interface JoinInvitationPreview {
  org_name: string;
  org_kind: OrgKind;
  inviter_name: string | null;
  side: "counselor" | "student";
  display_name: string | null;
  expires_at: string;
  state: "pending" | "accepted" | "expired" | "revoked";
}

/** Who is asking, as the page's heading and its first line show it. */
export interface JoinAsker {
  orgName: string;
  /** "Ms. Rivera invited you", "Ms. Rivera and Mr. Lee", or null when the organization has no named counselor. */
  line: string | null;
  /** Which door: an invitation (one person) or the organization's code. */
  source: "invite" | "code";
  /** A counselor-side invitation makes a member, not a grant. */
  side: "student" | "counselor";
  /** The invited person's first name ("Hi Alice"), from the invitation; null for a code. */
  greet: string | null;
}

/** A student a guardian may join for (studentsICanSee(), relation "guardian"). */
export interface JoinStudentChoice {
  id: string;
  name: string;
}

export type JoinState =
  /** Not a code or a token, or no organization or invitation has it. */
  | { kind: "not_found"; message: string }
  /** The invitation was used, has expired, or was cancelled. */
  | { kind: "closed"; asker: JoinAsker; message: string }
  /** Signed out: who is asking, the truth, then Sign in / Create an account (role defaulting to `role`). */
  | { kind: "signed_out"; asker: JoinAsker; signInHref: string; signUpHref: string }
  /** Signed in as a student: Join for their own record. */
  | { kind: "student"; asker: JoinAsker; segment: string }
  /** Signed in as a guardian: pick one of the students they can see, then Join for that student. */
  | { kind: "guardian"; asker: JoinAsker; segment: string; students: JoinStudentChoice[] }
  /** Signed in with an invitation to join the organization as a counselor. */
  | { kind: "counselor_invite"; asker: JoinAsker; segment: string }
  /** Signed in as a counselor, or with no student to join for: the link is for students and their parents. */
  | { kind: "not_for_you"; asker: JoinAsker };

export interface JoinInput {
  /** The raw `[code]` segment, as the URL had it. */
  segment: string;
  codePreview: JoinCodePreview | null;
  invitationPreview: JoinInvitationPreview | null;
  /** Null when signed out. */
  viewer: null | {
    /** The viewer's own student record, made on the spot for a student (currentStudent()); null for anyone else. */
    ownStudentId: string | null;
    /** The students the viewer reaches as a guardian (managed or in the household). */
    guardianOf: JoinStudentChoice[];
  };
}

const firstName = (name: string | null | undefined): string | null => name?.trim().split(/\s+/)[0] || null;

/** "Ms. Rivera", "Ms. Rivera and Mr. Lee", "Ms. Rivera, Mr. Lee, and 2 others". */
export function namesLine(names: string[]): string | null {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  if (clean.length === 3) return `${clean[0]}, ${clean[1]}, and ${clean[2]}`;
  return `${clean[0]}, ${clean[1]}, and ${clean.length - 2} others`;
}

function askerOf(input: JoinInput, target: JoinTarget): JoinAsker | null {
  if (target.kind === "invitation" && input.invitationPreview) {
    const p = input.invitationPreview;
    const inviter = p.inviter_name?.trim() || null;
    return { orgName: p.org_name, line: inviter ? `${inviter} invited you` : null, source: "invite", side: p.side, greet: firstName(p.display_name) };
  }
  if (target.kind === "code" && input.codePreview) {
    const p = input.codePreview;
    return { orgName: p.org_name, line: namesLine(p.counselor_names), source: "code", side: "student", greet: null };
  }
  return null;
}

const CLOSED: Record<Exclude<JoinInvitationPreview["state"], "pending">, string> = {
  accepted: ORG_ERRORS.invitation_used,
  expired: ORG_ERRORS.invitation_expired,
  revoked: ORG_ERRORS.invitation_revoked,
};

/** The `/join/[code]` page's state from what the server read. */
export function joinState(input: JoinInput): JoinState {
  const target = joinTarget(input.segment);
  const asker = askerOf(input, target);
  if (!asker) {
    return { kind: "not_found", message: target.kind === "invitation" ? ORG_ERRORS.invitation_not_found : ORG_ERRORS.no_such_code };
  }
  if (target.kind === "invitation" && input.invitationPreview && input.invitationPreview.state !== "pending") {
    return { kind: "closed", asker, message: CLOSED[input.invitationPreview.state] };
  }
  const segment = target.kind === "invitation" ? target.token : target.kind === "code" ? target.code : input.segment;
  const path = joinPath(input.segment);
  if (!input.viewer) {
    const role: RoleHint = asker.side === "counselor" ? "counselor" : "student";
    return { kind: "signed_out", asker, signInHref: loginHref(path), signUpHref: signUpHref(path, role) };
  }
  if (asker.side === "counselor") return { kind: "counselor_invite", asker, segment };
  if (input.viewer.ownStudentId) return { kind: "student", asker, segment };
  if (input.viewer.guardianOf.length > 0) return { kind: "guardian", asker, segment, students: input.viewer.guardianOf };
  return { kind: "not_for_you", asker };
}

/** This page's own path, for `next`: `/join/<segment>` exactly as it came (a code keeps its letters, a token its hex). */
export function joinPath(segment: string): string {
  const target = joinTarget(segment);
  if (target.kind === "invitation") return joinHref(target.token);
  if (target.kind === "code") return joinHref(target.code);
  return "/join";
}

/** "Create an account" with `next` back here and the role picked ("student" for a student's link). */
export function signUpHref(next: string, role: RoleHint = "student"): string {
  const path = safeNextPath(next, "");
  const q = new URLSearchParams({ mode: "signup", role });
  if (path) q.set("next", path);
  return `/login?${q.toString()}`;
}

/** The code as the page prints it ("QUAD-RIVERA"), or null for an invitation. */
export function shownCode(segment: string): string | null {
  const target = joinTarget(segment);
  return target.kind === "code" ? formatJoinCode(target.code) : null;
}

/**
 * `new_account` on `org_student_joined`: the account is new when its email was confirmed in the last two minutes,
 * as `signup_completed` judges it, or (where confirmation is off) when its profile was made that recently.
 */
export function isNewAccount(input: { email_confirmed_at?: string | null; confirmed_at?: string | null; profileCreated?: string | null }, now: number = Date.now()): boolean {
  if (isFreshConfirmation(input, now)) return true;
  const created = input.profileCreated ? Date.parse(input.profileCreated) : NaN;
  return !Number.isNaN(created) && Math.abs(now - created) <= FRESH_CONFIRMATION_MS;
}

/** Where a join lands: the student's advisor (their own: no `for`) with `joined=<grant id>`, which shows the notice. */
export function joinedHref(advisorHref: string, grantId: string): string {
  return `${advisorHref}${advisorHref.includes("?") ? "&" : "?"}joined=${encodeURIComponent(grantId)}`;
}

/**
 * What someone typed at /join, as the `/join/<segment>` to open, or null when it can't be a code: "QUAD-RIVERA",
 * "rivera", " quad rivera ", or a pasted link (".../join/RIVERA", ".../join/<token>").
 */
export function typedJoinPath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  const pasted = text.match(/\/join\/([^/?#\s]+)/);
  const target = joinTarget(pasted ? pasted[1] : text);
  if (target.kind === "invalid") return null;
  return joinHref(target.kind === "invitation" ? target.token : target.code);
}
