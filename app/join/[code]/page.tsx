import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { AccountsSetupError, authConfigured, currentStudent, getAccount, getUser, studentsICanSee } from "@/lib/auth";
import { codePreview, invitationPreview } from "@/lib/orgs";
import { isParent } from "@/lib/viewer-relation";
import { joinState, joinTarget, type JoinInput } from "@/lib/join-rules";
import { JoinView } from "./JoinView";

// An invitation token is a credential: keep this page out of search engines and out of Referer headers to other sites.
export const metadata: Metadata = { title: "Join a counselor", robots: { index: false }, referrer: "no-referrer" };

/**
 * /join/[code] (specs/product/counselor-portal.md "How a student joins", "The student's side"): `code` is a join code
 * ("QUAD-RIVERA", "rivera") or a 64-hex invitation token. Shows who is asking (org_code_preview /
 * org_invitation_preview, which work signed out) and the one-paragraph truth, then: signed out, Create an account
 * (a student by default) or Sign in, each coming back here; a student, Join for their own record (made now if
 * missing, as /me does); a guardian, a choice of the students they can see; a counselor-side invitation, Join as a
 * counselor; anyone else, the plain message. Used, expired, cancelled, and unknown links say so. The decision is
 * lib/join-rules.ts joinState; the markup is JoinView.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { code: segment } = await params;
  const target = joinTarget(segment);

  const [code, invitation, user] = await Promise.all([
    target.kind === "code" ? codePreview(target.code).catch(() => null) : null,
    target.kind === "invitation" ? invitationPreview(target.token).catch(() => null) : null,
    getUser(),
  ]);

  let viewer: JoinInput["viewer"] = null;
  if (user && (code || invitation?.state === "pending")) {
    try {
      const account = await getAccount();
      if (account && !account.profile.deleted_at) {
        // A counselor-side invitation needs no student; a student's own record is made on the spot (currentStudent()).
        const counselorSide = invitation?.side === "counselor";
        const [own, seen] = counselorSide ? [null, []] : await Promise.all([currentStudent(), studentsICanSee()]);
        viewer = {
          ownStudentId: own?.id ?? null,
          guardianOf: seen.filter((a) => isParent(a.relation)).map((a) => ({ id: a.student.id, name: a.student.display_name?.trim() || "Your student" })),
        };
      }
    } catch (err) {
      if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
      throw err;
    }
  }

  const state = joinState({ segment, codePreview: code, invitationPreview: invitation, viewer: user ? (viewer ?? { ownStudentId: null, guardianOf: [] }) : null });
  return <JoinView state={state} signedIn={Boolean(user)} />;
}
