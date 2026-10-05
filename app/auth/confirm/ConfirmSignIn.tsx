"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loginHref, parseAuthFragment, safeNextPath } from "@/lib/accounts";
import { completeSignIn } from "./actions";

/**
 * Reads the session a magic link brings back in the URL fragment (which never reaches the server), hands it to the
 * completeSignIn Server Action to become the site's cookies, and moves on to ?next=. Works in whichever browser opens
 * the email, unlike the default PKCE link, which needs the browser that asked for it.
 */
export function ConfirmSignIn() {
  const [state, setState] = useState<"working" | "failed" | "expired">("working");
  const [next, setNext] = useState("/account");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    const target = safeNextPath(url.searchParams.get("next"), "/account");
    // A ?code= or ?token_hash= link (PKCE, or a custom template later) is handled by the route handler.
    if (url.searchParams.has("code") || url.searchParams.has("token_hash")) {
      window.location.replace(`/auth/callback${url.search}`);
      return;
    }
    const fragment = parseAuthFragment(url.hash) ?? parseAuthFragment(url.search);
    // Keep the tokens out of history and out of anything that copies the address.
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    const fail = (kind: "failed" | "expired") => {
      setNext(target);
      setState(kind);
    };
    if (!fragment) return fail("failed");
    if (!fragment.ok) return fail(/expired|otp/i.test(fragment.code) ? "expired" : "failed");
    completeSignIn(fragment.accessToken, fragment.refreshToken)
      .then((r) => (r.ok ? window.location.replace(target) : fail("failed")))
      .catch(() => fail("failed"));
  }, []);

  if (state === "working") return <p className="text-muted-foreground">Signing you in…</p>;
  return (
    <div className="space-y-4">
      <p>
        {state === "expired"
          ? "That sign-in link has expired or was already used. Links work once, for about an hour."
          : "We couldn't sign you in with that link."}
      </p>
      <Link href={loginHref(next)} className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
        Send a new link
      </Link>
    </div>
  );
}
