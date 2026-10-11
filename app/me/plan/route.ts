import { NextResponse, type NextRequest } from "next/server";

/**
 * /me/plan (specs/planner/redesign/page.md "Account menu"): the plan moved to the top level, one address for a
 * student and a guardian alike, so this always goes to `/plan` now (it resolves the viewer itself).
 */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/plan", request.nextUrl.origin));
}
