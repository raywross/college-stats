/**
 * The header's state at first paint (specs/product/accounts.md "Header state"): a second plain cookie beside the
 * signed-in marker, `quad_me`, holding only what the header shows before /api/me answers: the avatar's initials
 * (initialsFor) and the navigation role (meRoleOf), as `M.counselor`. No name, no email, no ids. A hint only: the
 * server never reads it for anything, useMe's state still comes from /api/me, and a wrong or missing hint costs
 * one letter or one label for as long as /api/me takes.
 *
 * Written where the session is established (lib/me-hint-server.ts, after a sign-in) and re-read (/api/me, on every
 * signed-in answer); cleared wherever the marker is (meHintClearFor beside signedInCookieFor). Read twice in the
 * browser, by the same rule: by ME_FIRST_PAINT_SCRIPT, an inline script in the header that runs before any bundle,
 * and by useMe's first state (readMeHint). No imports beyond lib/accounts.ts, so the script and the tests agree.
 */
import { SIGNED_IN_COOKIE, type CookieToSet, type MeRole, type MeState } from "@/lib/accounts";

export const ME_HINT_COOKIE = "quad_me";

const ROLES: readonly MeRole[] = ["student", "guardian", "counselor"];

/** The initials a hint may carry: one or two characters (an astral letter is two), never a quote or backslash. */
const INITIALS_RE = /^[^"\\;,\s]{1,2}$/;

/** The cookie's value for these initials and role: `M.counselor`, or `M.` with no role yet. */
export function meHintValue(initials: string, role: MeRole | null): string {
  return `${INITIALS_RE.test(initials) ? initials : ""}.${role ?? ""}`;
}

/** One cookie's raw value from a `document.cookie` string, or null. */
function cookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

export interface MeHint {
  /** The marker says a session is stored (`quad_signed_in=1`). */
  signedIn: boolean;
  /** The avatar's initials; "" when there is no hint (the placeholder shows an empty circle). */
  initials: string;
  role: MeRole | null;
}

/**
 * What the header shows before /api/me, from a `document.cookie` string. Signed out ignores any hint (a hint left
 * over without the marker shows nothing); a malformed hint is no hint.
 */
export function readMeHint(cookie: string): MeHint {
  const signedIn = cookieValue(cookie, SIGNED_IN_COOKIE) === "1";
  if (!signedIn) return { signedIn, initials: "", role: null };
  const raw = cookieValue(cookie, ME_HINT_COOKIE);
  let value = "";
  try {
    value = raw ? decodeURIComponent(raw) : "";
  } catch {
    value = "";
  }
  const dot = value.lastIndexOf(".");
  if (dot < 0) return { signedIn, initials: "", role: null };
  const initials = value.slice(0, dot);
  const role = value.slice(dot + 1);
  return { signedIn, initials: INITIALS_RE.test(initials) ? initials : "", role: (ROLES as readonly string[]).includes(role) ? (role as MeRole) : null };
}

/**
 * The inline script the header renders before its account slots (components/layout/MeFirstPaint.tsx). It runs as the
 * HTML is parsed, before any bundle: it sets `<html data-me="in|out">`, which app/globals.css uses to show "Sign in" or
 * the avatar placeholder, and the `--me-initials` custom property the placeholder prints. It touches only <html>
 * (whose hydration warnings the root layout suppresses), never an element or text React renders, so hydration sees
 * exactly the server's tree. The same rule as readMeHint (tests/me-hint.test.mts runs both over the same cookies).
 * ES5, no dependencies, wrapped in try so a blocked cookie jar leaves the slot as it was (hidden until hydration).
 */
export const ME_FIRST_PAINT_SCRIPT =
  `(function(d){try{` +
  `var c=d.cookie,g=function(n){var m=c.match(new RegExp("(?:^|;\\\\s*)"+n+"=([^;]*)"));return m?m[1]:null};` +
  `var s=g(${JSON.stringify(SIGNED_IN_COOKIE)})==="1",h="";` +
  `if(s){var v="";try{v=decodeURIComponent(g(${JSON.stringify(ME_HINT_COOKIE)})||"")}catch(e){}` +
  `var i=v.lastIndexOf(".");h=i<0?"":v.slice(0,i);if(!${INITIALS_RE.toString()}.test(h))h=""}` +
  `var e=d.documentElement;e.setAttribute("data-me",s?"in":"out");e.style.setProperty("--me-initials",JSON.stringify(h))` +
  `}catch(x){}})(document)`;

/**
 * The hint's clearing cookie for a batch of session cookies that clears the session (sign-out, account deletion, an
 * expired refresh in proxy.ts), with the marker's options; null otherwise. Writing the hint needs the profile, so it
 * happens apart (lib/me-hint-server.ts); clearing travels with the marker.
 */
export function meHintClearFor<O extends { maxAge?: number; httpOnly?: boolean }>(toSet: readonly CookieToSet<O>[]): CookieToSet<O> | null {
  const session = toSet.filter((c) => c.name.startsWith("sb-"));
  if (session.length === 0) return null;
  const writing = session.some((c) => c.value !== "" && (c.options.maxAge ?? 1) > 0);
  return writing ? null : { name: ME_HINT_COOKIE, value: "", options: { ...session[0].options, httpOnly: false, maxAge: 0 } };
}

const SIGNED_OUT: MeState = { configured: true, signedIn: false, id: null, name: null, email: null, org: false, admin: false, role: null, children: [] };

/**
 * The header's state seeded from a hint, until /api/me answers: signed in, the role (a counselor's org flag with it,
 * so the role item and RefreshHeader agree), and the initials; no id, name, email, admin, or children. Null without
 * initials (the placeholder holds the slot, as before the hint).
 */
export function meFromHint(hint: MeHint): MeState | null {
  if (!hint.signedIn || !hint.initials) return null;
  return { configured: true, signedIn: true, id: null, name: null, email: null, org: hint.role === "counselor", admin: false, role: hint.role, children: [], initials: hint.initials };
}

/**
 * useMe's first state, before any request (components/account/useMe.ts initial()): a remembered /api/me answer that
 * agrees with the marker and is younger than `ttlMs`; else, signed in, the hint's seed (null without one); else
 * signed out. `fromStore` says whether the remembered answer was used (it counts as answered; a seed does not).
 */
export function firstMeState(
  cookie: string,
  stored: { at: number; data: MeState } | null,
  now: number,
  ttlMs: number,
): { me: MeState | null; fromStore: boolean } {
  const hint = readMeHint(cookie);
  if (stored && stored.data.signedIn === hint.signedIn && now - stored.at < ttlMs) return { me: stored.data, fromStore: true };
  return { me: hint.signedIn ? meFromHint(hint) : SIGNED_OUT, fromStore: false };
}

/**
 * What ME_FIRST_PAINT_SCRIPT does, for the browser's later changes (useMe, when the marker changes without a page
 * load: a sign-in that lands by client navigation): `<html data-me>` and `--me-initials` from a hint.
 */
export function paintMeHint(root: { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void } }, hint: MeHint): void {
  root.setAttribute("data-me", hint.signedIn ? "in" : "out");
  root.style.setProperty("--me-initials", JSON.stringify(hint.initials));
}
