import { getData } from "@/lib/data";
import { authConfigured } from "@/lib/auth";
import { parseViewBody, shouldRecordView } from "@/lib/college-views";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * POST { unit, page }: record one view of a college's profile page (specs/product/college-views.md). The profile pages
 * are static, so the browser sends this after the page loads (components/profile/ViewBeacon.tsx). The view is filed
 * under whoever the session cookies say is signed in, or under nobody; record_college_view() reads the user from the
 * session, never from the body. Always answers 204: a view that isn't recorded (a privacy signal, a bot, an unknown
 * college, a repeat, Supabase down) is not the visitor's problem.
 */
export async function POST(request: Request) {
  const done = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (!authConfigured() || !shouldRecordView(request.headers)) return done;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return done;
  }
  const view = parseViewBody(body);
  if (!view) return done;
  const data = await getData();
  if (!data.getSchoolById(view.unit)) return done;
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("record_college_view", { p_unit: view.unit, p_page: view.page });
    if (error && error.code !== "PGRST202") console.warn(`[college-view] not recorded: ${error.code ?? ""} ${error.message}`);
  } catch (err) {
    console.warn("[college-view] not recorded:", err instanceof Error ? err.message : err);
  }
  return done;
}
