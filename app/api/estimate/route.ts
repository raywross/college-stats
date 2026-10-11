import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { estimateContext, estimateMany, estimateWithLikeYou } from "@/lib/chances/estimate";
import { parseEstimateRequest, publicResult, requestCost, withCounterfactual } from "@/lib/chances/estimate-request";
import { clientIp, createLimiter, take } from "@/lib/chances/rate-limit";
import type { EstimateResult } from "@/lib/chances/types";

/** One limiter per server instance (owner assumption 4: in-memory before launch, a durable one at launch). */
const limiter = createLimiter();

/**
 * POST /api/estimate (specs/chances/estimate.md "Architecture"): Quad's estimate for one student at up to 20
 * colleges signed out or 25 signed in, optionally with a counterfactual ("this score", "this course added").
 *
 *   body:     { student: EstimateStudent, unitIds: string[], counterfactual?: { score?: number; addCourse?: CourseEntry },
 *               context?: { coreAtTopLevel?: CoreAtTopLevel; grade?: 9 | 10 | 11 | 12 }, likeYou?: boolean }
 *   response: { results: Record<unitId, EstimateResult>, likeYou?: { n, admitted, seasons, residency } | null }
 *
 * The session is optional; the limiter is per IP and, signed in, per user. The response carries only the contract's
 * fields (lib/chances/estimate-request.ts publicResult): the group, the label, the kinds of input used or missing,
 * cited facts, catalog notes, the send advice, the move-up, and the model version. `context` is what the saved profile
 * adds (the core-subject answers and the grade), as the server load passes it. `likeYou`, for a single college, adds
 * what happened to students in the same position (lib/chances/like-you.ts; null until the data clears its thresholds).
 * Never cached.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const user = await getUser().catch(() => null);
  const parsed = parseEstimateRequest(body, { signedIn: user !== null });
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });

  const { student: given, unitIds, counterfactual, context, likeYou } = parsed.request;
  const allowed = take(limiter, { ip: clientIp(request.headers), userId: user?.id ?? null }, requestCost(unitIds));
  if (!allowed.ok) {
    return NextResponse.json({ error: "Too many requests. Try again in a moment." }, { status: 429, headers: { "Retry-After": String(allowed.retryAfter) } });
  }

  const student = withCounterfactual(given, counterfactual);
  const ctx = await estimateContext(student, context);
  let raw: Record<string, EstimateResult>;
  let like: Awaited<ReturnType<typeof estimateWithLikeYou>>["likeYou"] = null;
  if (likeYou && !counterfactual && ctx.schoolById(unitIds[0])) {
    const answered = await estimateWithLikeYou({ student, unitId: unitIds[0] }, ctx);
    raw = { [unitIds[0]]: answered.result };
    like = answered.likeYou;
  } else {
    raw = estimateMany(student, unitIds, ctx);
  }
  const results: Record<string, EstimateResult> = {};
  for (const [id, r] of Object.entries(raw)) results[id] = publicResult(r);
  return NextResponse.json(likeYou ? { results, likeYou: like } : { results }, { headers: { "Cache-Control": "no-store" } });
}
