import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { STANDING_LEVELS } from "@/lib/chances/levels";
import type { StandingLevel } from "@/lib/chances/types";
import { railFor, type RailCard } from "@/lib/planner/rail-server";
import type { ShapeGapKind } from "@/lib/planner/list-shape";

const SHAPE_GAP_KINDS: readonly ShapeGapKind[] = ["likely_min", "affordable", "target_min", "reach_min", "over_max", "total_off"];

const json = (cards: RailCard[]) => NextResponse.json({ cards }, { headers: { "Cache-Control": "no-store" } });

function isLevel(v: unknown): v is StandingLevel {
  return typeof v === "string" && (STANDING_LEVELS as readonly string[]).includes(v);
}

function isGap(v: unknown): v is ShapeGapKind {
  return typeof v === "string" && (SHAPE_GAP_KINDS as readonly string[]).includes(v);
}

/**
 * POST /api/plan/rail (specs/planner/next-steps/list-shape.md "The rail"): colleges at a missing level for a
 * shape_gap move's "Show some" button. Signed in only; `loadPlanFor` (lib/planner/rail-server.ts railFor) is the
 * access check, so a stranger's studentId gets an empty rail, same as any other failure — never a distinct error,
 * and never a closeness or estimate number in the response.
 *
 *   body:     { studentId: string, level: StandingLevel, gap: ShapeGapKind }
 *   response: { cards: RailCard[] }
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return json([]);
    const body = (await request.json().catch(() => null)) as { studentId?: unknown; level?: unknown; gap?: unknown } | null;
    if (!body || typeof body.studentId !== "string" || !isLevel(body.level) || !isGap(body.gap)) return json([]);
    const result = await railFor({ studentId: body.studentId, level: body.level, gap: body.gap });
    return json(result.ok ? result.cards : []);
  } catch {
    return json([]);
  }
}
