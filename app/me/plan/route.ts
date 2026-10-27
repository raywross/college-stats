import { NextResponse, type NextRequest } from "next/server";
import { ADVISOR_PATH } from "@/lib/planner/advisor";

/**
 * /me/plan (specs/planner/redesign/page.md "Account menu"): the plan moved to the top level, one address for a
 * student and a guardian alike, so this always goes to `/advisor` now (it resolves the viewer itself; the route was
 * `/plan` until the rename, specs/product/advisor.md "1. The name").
 */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL(ADVISOR_PATH, request.nextUrl.origin));
}
