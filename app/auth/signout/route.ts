import { NextResponse, type NextRequest } from "next/server";
import { authConfigured } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * Sign out (POST only, from a form: a GET link could be triggered by a prefetch or another site). Clears the session
 * cookies and returns home. Requests from another origin are refused.
 */
export async function POST(request: NextRequest) {
  // The same check Next.js makes for Server Actions: the Origin's host must be the host the request was sent to.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && (!host || hostOf(origin) !== host)) return new Response("Forbidden", { status: 403 });
  if (authConfigured()) {
    const supabase = await createServerSupabase();
    await supabase.auth.signOut({ scope: "local" });
  }
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), 303);
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
