import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, currentStudent, getUser } from "@/lib/auth";
import { loginHref } from "@/lib/accounts";
import { ownPersonPath } from "@/lib/household-hub";

/**
 * /me/plan (specs/planner/model.md "Where it lives"): the viewer's own Plan tab, like /me/list. A student goes to
 * /household/<their student id>/plan; someone without a student record (a guardian) has no Plan tab, so they go to
 * their own page, whose list rows carry the planner's controls. Signed out: sign in, then come back here.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!authConfigured()) return NextResponse.redirect(new URL("/household", origin));
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL(loginHref("/me/plan"), origin));
  let studentId: string | null = null;
  try {
    studentId = (await currentStudent())?.id ?? null;
  } catch {
    return NextResponse.redirect(new URL("/household", origin));
  }
  const own = ownPersonPath(studentId, user.id);
  return NextResponse.redirect(new URL(studentId ? `${own}/plan` : own, origin));
}
