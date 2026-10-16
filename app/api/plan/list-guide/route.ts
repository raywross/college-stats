import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { STANDING_LEVELS } from "@/lib/chances/levels";
import type { StandingLevel } from "@/lib/chances/types";
import { parseChips } from "@/lib/planner/list-guide";
import { allowedPlaces, freshmanPage, GAP_LEVEL, guidePage, isFreshmanView } from "@/lib/planner/list-guide-server";
import type { ShapeGapKind } from "@/lib/planner/list-shape";
import { loadPlanFor } from "@/lib/planner/load";

const SHAPE_GAP_KINDS: readonly ShapeGapKind[] = ["likely_min", "affordable", "target_min", "reach_min", "over_max", "total_off"];
const NO_STORE = { "Cache-Control": "no-store" };

const isLevel = (v: unknown): v is StandingLevel => typeof v === "string" && (STANDING_LEVELS as readonly string[]).includes(v);
const isGap = (v: unknown): v is ShapeGapKind => typeof v === "string" && (SHAPE_GAP_KINDS as readonly string[]).includes(v);
const offsetOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 10_000) : 0);

/**
 * POST /api/plan/list-guide (specs/planner/v3/guides/list-size.md "Show more"): the next page of the Build your list
 * guide's cards, in the page's own order (lib/planner/list-guide-server.ts). Signed in only; `loadPlanFor` is the
 * access check, so a student the caller can't see is a 404. Never a closeness or estimate number in the response:
 * the cards carry the level alone.
 *
 *   body:     { studentId, gap, level, offset }   a gap's cards (a folded section opened, or "Show more")
 *             { studentId, chips, offset }        the freshman view's cards for the chips toggled on
 *   response: { cards: AlikeCard[], total: number, fallback: boolean }
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to see this." }, { status: 401, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { studentId?: unknown; gap?: unknown; level?: unknown; offset?: unknown; chips?: unknown } | null;
  if (!body || typeof body.studentId !== "string") return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });

  const load = await loadPlanFor(body.studentId);
  if (load.kind !== "ready") return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  const { ctx } = load;
  const offset = offsetOf(body.offset);

  if (body.chips !== undefined) {
    const chips = parseChips(body.chips, allowedPlaces(ctx));
    if (!chips || !isFreshmanView(ctx)) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
    return NextResponse.json(await freshmanPage(ctx, chips, offset), { headers: NO_STORE });
  }

  if (!isGap(body.gap)) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const level = isLevel(body.level) ? body.level : (GAP_LEVEL[body.gap] ?? null);
  if (!level) return NextResponse.json({ cards: [], total: 0, fallback: false }, { headers: NO_STORE });
  return NextResponse.json(await guidePage(ctx, { gap: body.gap, level, offset }), { headers: NO_STORE });
}
