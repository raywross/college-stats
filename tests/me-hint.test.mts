/**
 * The header's state at first paint (specs/product/accounts.md "Header state", lib/me-hint.ts): the `quad_me` hint
 * cookie's format, the rule that reads it (readMeHint) and the inline script that applies it before any bundle
 * (ME_FIRST_PAINT_SCRIPT, run here in a sandbox over the same cookies), useMe's first state from it (firstMeState),
 * its clearing beside the marker, and, by reading source, where it is written and cleared and how the header renders
 * both states with the script ahead of them. No network, no database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import type { MeState } from "../lib/accounts.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

// `@/…` imports resolve to the repo root (lib/me-hint.ts reads lib/accounts.ts through the alias).
type ResolveResult = { url: string; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
const { registerHooks } = nodeModule as unknown as { registerHooks(hooks: { resolve(s: string, c: { parentURL?: string }, n: NextResolve): ResolveResult }): void };
const asFile = (b: string) => [b, `${b}.ts`, `${b}.tsx`].find((c) => existsSync(c)) ?? null;
registerHooks({
  resolve(specifier, context, next) {
    let b: string | null = null;
    if (specifier.startsWith("@/")) b = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !context.parentURL.includes("/node_modules/")) b = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = b ? (/\.tsx?$/.test(b) && existsSync(b) ? b : asFile(b)) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    return next(specifier, context);
  },
});

const { ME_HINT_COOKIE, ME_FIRST_PAINT_SCRIPT, firstMeState, meFromHint, meHintClearFor, meHintValue, paintMeHint, readMeHint } = (await import(
  "../lib/me-hint.ts"
)) as typeof import("../lib/me-hint.ts");

/** A cookie value the way Next writes it (ResponseCookies encodes with encodeURIComponent). */
const hint = (initials: string, role: Parameters<typeof meHintValue>[1]) => `${ME_HINT_COOKIE}=${encodeURIComponent(meHintValue(initials, role))}`;

/** Runs the inline script against a fake document; returns what it left on <html>. */
function runScript(cookie: string): { me: string | null; initials: string | null } {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const documentElement = { setAttribute: (n: string, v: string) => (attrs[n] = v), style: { setProperty: (n: string, v: string) => (props[n] = v) } };
  runInNewContext(ME_FIRST_PAINT_SCRIPT, { document: { cookie, documentElement } });
  return { me: attrs["data-me"] ?? null, initials: props["--me-initials"] ?? null };
}

/** What paintMeHint (and so the script, by the same rule) should leave for readMeHint's answer. */
function painted(cookie: string): { me: string | null; initials: string | null } {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  paintMeHint({ setAttribute: (n, v) => (attrs[n] = v), style: { setProperty: (n, v) => (props[n] = v) } }, readMeHint(cookie));
  return { me: attrs["data-me"] ?? null, initials: props["--me-initials"] ?? null };
}

const COOKIES = [
  "",
  "quad_signed_in=1",
  `quad_signed_in=1; ${hint("M", "counselor")}`,
  `theme=dark; ${hint("É", "guardian")}; quad_signed_in=1; other=x`,
  `${hint("M", "counselor")}`, // a hint left over without the marker: signed out
  `quad_signed_in=1; ${hint("😀", null)}`,
  `quad_signed_in=1; ${ME_HINT_COOKIE}=M.wizard`,
  `quad_signed_in=1; ${ME_HINT_COOKIE}=%E0%A4%A`, // malformed escape
  `quad_signed_in=1; ${ME_HINT_COOKIE}=${encodeURIComponent('"x.student')}`,
  `quad_signed_in=1; ${ME_HINT_COOKIE}=ABC.student`,
  `quad_signed_in=0; ${hint("M", "student")}`,
  `xquad_signed_in=1; ${hint("M", "student")}`,
];

test("the hint's value: initials and role, `M.counselor`; no role yet is `M.`; initials that could break the CSS string are dropped", () => {
  assert.equal(meHintValue("M", "counselor"), "M.counselor");
  assert.equal(meHintValue("M", null), "M.");
  assert.equal(meHintValue('"', "student"), ".student");
  assert.equal(meHintValue("ABC", "student"), ".student", "initialsFor gives one letter; three is not a hint");
});

test("readMeHint: the marker decides signed in; the hint gives initials and a known role; anything malformed is no hint", () => {
  assert.deepEqual(readMeHint(""), { signedIn: false, initials: "", role: null });
  assert.deepEqual(readMeHint("quad_signed_in=1"), { signedIn: true, initials: "", role: null });
  assert.deepEqual(readMeHint(`quad_signed_in=1; ${hint("M", "counselor")}`), { signedIn: true, initials: "M", role: "counselor" });
  assert.deepEqual(readMeHint(`theme=dark; ${hint("É", "guardian")}; quad_signed_in=1`), { signedIn: true, initials: "É", role: "guardian" });
  assert.deepEqual(readMeHint(hint("M", "counselor")), { signedIn: false, initials: "", role: null }, "no marker, no avatar");
  assert.deepEqual(readMeHint(`quad_signed_in=1; ${ME_HINT_COOKIE}=M.wizard`), { signedIn: true, initials: "M", role: null });
  assert.deepEqual(readMeHint(`quad_signed_in=1; ${ME_HINT_COOKIE}=%E0%A4%A`), { signedIn: true, initials: "", role: null });
  assert.deepEqual(readMeHint(`xquad_signed_in=1; ${hint("M", "student")}`), { signedIn: false, initials: "", role: null });
});

test("the inline script paints exactly what readMeHint says, for every cookie jar (data-me and --me-initials)", () => {
  for (const cookie of COOKIES) assert.deepEqual(runScript(cookie), painted(cookie), `cookie: ${cookie}`);
  assert.deepEqual(runScript(`quad_signed_in=1; ${hint("M", "counselor")}`), { me: "in", initials: '"M"' });
  assert.deepEqual(runScript(""), { me: "out", initials: '""' });
});

test("the inline script is small, self-contained, and fails soft", () => {
  assert.ok(ME_FIRST_PAINT_SCRIPT.length < 600, `the script is ${ME_FIRST_PAINT_SCRIPT.length} bytes`);
  assert.doesNotMatch(ME_FIRST_PAINT_SCRIPT, /<\/script|=>|\blet\b|\bconst\b|`/, "ES5, nothing that ends the tag");
  // A document whose cookie getter throws (blocked storage) leaves <html> alone and throws nothing.
  const documentElement = { setAttribute: () => assert.fail("painted without cookies"), style: { setProperty: () => assert.fail("painted without cookies") } };
  runInNewContext(ME_FIRST_PAINT_SCRIPT, {
    document: Object.defineProperty({ documentElement }, "cookie", {
      get() {
        throw new Error("blocked");
      },
    }),
  });
});

const SIGNED_OUT: MeState = { configured: true, signedIn: false, id: null, name: null, email: null, org: false, admin: false, role: null, children: [] };
const ANSWER: MeState = { configured: true, signedIn: true, id: "u1", name: "Maria Ruiz", email: "m@example.com", org: true, admin: false, role: "counselor", children: [] };
const TTL = 5 * 60_000;

test("useMe's first state: a fresh remembered answer that agrees wins; else the hint's seed; else null signed in, signed out without the marker", () => {
  const signedIn = `quad_signed_in=1; ${hint("M", "counselor")}`;
  assert.deepEqual(firstMeState(signedIn, { at: 1000, data: ANSWER }, 1000 + TTL - 1, TTL), { me: ANSWER, fromStore: true });
  const seeded = firstMeState(signedIn, { at: 1000, data: ANSWER }, 1000 + TTL, TTL);
  assert.equal(seeded.fromStore, false, "a stale answer is not used, and a seed is not an answer (/api/me is asked)");
  assert.deepEqual(seeded.me, { configured: true, signedIn: true, id: null, name: null, email: null, org: true, admin: false, role: "counselor", children: [], initials: "M" });
  assert.deepEqual(firstMeState(signedIn, { at: 1000, data: SIGNED_OUT }, 1001, TTL).me?.initials, "M", "a remembered signed-out answer disagrees with the marker");
  assert.deepEqual(firstMeState("quad_signed_in=1", null, 0, TTL), { me: null, fromStore: false }, "no hint: the placeholder, as before");
  assert.deepEqual(firstMeState(hint("M", "student"), null, 0, TTL), { me: SIGNED_OUT, fromStore: false });
  assert.equal(meFromHint({ signedIn: true, initials: "J", role: "guardian" })?.org, false);
  assert.equal(meFromHint({ signedIn: true, initials: "J", role: null })?.role, null, "no role: the role item stays Advisor until /api/me");
});

test("meHintClearFor: the hint is cleared with the session (beside the marker), never written by it", () => {
  const session = (value: string, maxAge = 400 * 86400) => ({ name: "sb-abc-auth-token", value, options: { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge } });
  assert.deepEqual(meHintClearFor([session("", 0)]), { name: ME_HINT_COOKIE, value: "", options: { httpOnly: false, sameSite: "lax", path: "/", maxAge: 0 } });
  assert.equal(meHintClearFor([session("eyJ…")]), null);
  assert.equal(meHintClearFor([]), null);
  assert.equal(meHintClearFor([{ name: "age_gate", value: "", options: { httpOnly: true, maxAge: 0 } }]), null);
});

test("the hint is written after every sign-in and on every signed-in /api/me answer, and cleared wherever the marker is", () => {
  const login = read("app/login/actions.ts");
  assert.equal(login.match(/writeMeHintAfterSignIn\(supabase, /g)?.length, 2, "password sign-in and sign-up straight in");
  assert.match(read("app/auth/confirm/actions.ts"), /writeMeHintAfterSignIn\(supabase, data\.user\)/, "the magic link's confirmation");
  const me = read("app/api/me/route.ts");
  assert.match(me, /if \(me\.signedIn\) await writeMeHint\(initialsFor\(me\.name, me\.email\), me\.role\)/);
  assert.equal(me.match(/Response\.json\(/g)?.length, 2, "every answer goes through answer() except the unconfigured one");
  for (const file of ["lib/supabase-server.ts", "proxy.ts"]) assert.match(read(file), /meHintClearFor\(toSet\)/, `${file} doesn't clear the hint with the session`);
  const server = read("lib/me-hint-server.ts");
  assert.match(server, /httpOnly: false/, "readable by scripts");
  assert.match(server, /AUTH_COOKIE_OPTIONS/, "the marker's path, sameSite, and secure");
});

test("first paint: the root layout runs the script before the header; the slot holds both states; CSS shows one by <html data-me>", () => {
  const layout = read("app/layout.tsx");
  assert.ok(layout.indexOf("<MeFirstPaint />") > 0 && layout.indexOf("<MeFirstPaint />") < layout.indexOf("<Header />"), "the script comes before the header");
  const paint = read("components/layout/MeFirstPaint.tsx");
  assert.match(paint, /<script id="me-first-paint" dangerouslySetInnerHTML=\{\{ __html: ME_FIRST_PAINT_SCRIPT \}\} \/>/);
  assert.doesNotMatch(paint, /^"use client"/m, "a Server Component");
  assert.doesNotMatch(paint, /from "next\/script"/, "beforeInteractive waits for Next's bootstrap");
  const menu = read("components/account/AccountMenu.tsx");
  assert.match(menu, /if \(!me\) return <MeFirstPaintSlot /, "the slot until the state is known (the server HTML and hydration)");
  assert.match(menu, /data-me-show="out"[^>]*>\s*Sign in/);
  assert.match(menu, /<a href="\/account" data-me-show="in" aria-label="Your account" className=\{AVATAR_CLS\} \/>/, "the placeholder renders no text: the initials are CSS");
  assert.match(menu, /me\.initials \?\? initialsFor\(me\.name, me\.email\)/);
  const css = read("app/globals.css");
  const rules = css.slice(css.indexOf("[data-me-show] {"));
  assert.match(rules, /\[data-me-show\] \{\s*display: none;/, "hidden until the script runs");
  assert.match(rules, /html\[data-me="out"\] \[data-me-show="out"\],\s*html\[data-me="in"\] \[data-me-show="in"\] \{\s*display: inline-flex;/);
  assert.match(rules, /\[data-me-show="in"\]::after \{\s*content: var\(--me-initials, ""\);/);
  assert.ok(css.lastIndexOf("@layer") < css.indexOf("[data-me-show] {"), "unlayered, so it outranks the utilities");
  assert.match(layout, /<html[^>]*suppressHydrationWarning/, "the script's attributes on <html> are not a mismatch");
});

test("useMe seeds from the hint and repaints <html> when the marker changes without a reload; the role item and tab bar read it", () => {
  const useMe = read("components/account/useMe.ts");
  assert.match(useMe, /firstMeState\(document\.cookie, stored, Date\.now\(\), MEMO_TTL_MS\)/);
  assert.match(useMe, /paintMeHint\(document\.documentElement, hint\)/);
  assert.match(useMe, /set\(signedIn \? meFromHint\(hint\) : SIGNED_OUT, 0\)/);
  for (const file of ["components/layout/Header.tsx", "components/layout/BottomNav.tsx"]) assert.match(read(file), /roleNav\(me\)/, `${file}'s role item reads useMe`);
});
