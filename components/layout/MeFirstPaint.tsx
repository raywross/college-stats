import { ME_FIRST_PAINT_SCRIPT } from "@/lib/me-hint";
import { supabaseAuthEnv } from "@/lib/supabase-server";

/**
 * The header's state before any JavaScript (specs/product/accounts.md "Header state"): a plain inline <script> in the
 * root layout, just before the header, so the browser runs it while parsing, before it paints the account slot. It
 * reads the two plain cookies (the signed-in marker and the `quad_me` hint) and sets `<html data-me>` and
 * `--me-initials` (lib/me-hint.ts ME_FIRST_PAINT_SCRIPT); app/globals.css then shows AccountMenu's "Sign in" or its
 * avatar placeholder with the initials. A few hundred bytes, no request, no dependency: it doesn't hold up the stream.
 *
 * A plain <script> in a Server Component, not next/script: `beforeInteractive` in the App Router is queued for Next's
 * bootstrap (`self.__next_s`), so it runs only after the framework's scripts load, which is the wait this removes.
 * It changes only <html> (the root layout suppresses its hydration warnings), so hydration matches the server's tree.
 * Where sign-in isn't configured there's no script: both stay hidden and AccountMenu renders nothing, as before.
 */
export function MeFirstPaint() {
  if (!supabaseAuthEnv()) return null;
  return <script id="me-first-paint" dangerouslySetInnerHTML={{ __html: ME_FIRST_PAINT_SCRIPT }} />;
}
