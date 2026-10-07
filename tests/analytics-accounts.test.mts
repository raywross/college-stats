/**
 * Telemetry, accounts side (specs/product/telemetry.md): the rule that decides when `signup_completed` is sent, the
 * sign-up events' wiring, and the /privacy page and its links. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FRESH_CONFIRMATION_MS, isFreshConfirmation } from "../lib/signup-events-rules.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/* ---------------- isFreshConfirmation ---------------- */

const NOW = Date.parse("2026-11-03T15:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

test("isFreshConfirmation: confirmed within two minutes counts, three minutes ago doesn't", () => {
  assert.equal(FRESH_CONFIRMATION_MS, 2 * MIN);
  assert.equal(isFreshConfirmation({ email_confirmed_at: ago(0) }, NOW), true);
  assert.equal(isFreshConfirmation({ email_confirmed_at: ago(90_000) }, NOW), true);
  assert.equal(isFreshConfirmation({ email_confirmed_at: ago(2 * MIN) }, NOW), true);
  assert.equal(isFreshConfirmation({ email_confirmed_at: ago(2 * MIN + 1) }, NOW), false);
  assert.equal(isFreshConfirmation({ email_confirmed_at: ago(3 * MIN) }, NOW), false);
  assert.equal(isFreshConfirmation({ email_confirmed_at: ago(40 * 24 * 60 * MIN) }, NOW), false);
});

test("isFreshConfirmation: falls back to confirmed_at, and missing or broken dates never count", () => {
  assert.equal(isFreshConfirmation({ confirmed_at: ago(MIN) }, NOW), true);
  assert.equal(isFreshConfirmation({ email_confirmed_at: null, confirmed_at: ago(MIN) }, NOW), true);
  assert.equal(isFreshConfirmation({ email_confirmed_at: ago(10 * MIN), confirmed_at: ago(MIN) }, NOW), false, "email_confirmed_at wins");
  assert.equal(isFreshConfirmation({}, NOW), false);
  assert.equal(isFreshConfirmation({ email_confirmed_at: null, confirmed_at: null }, NOW), false);
  assert.equal(isFreshConfirmation({ email_confirmed_at: "not a date" }, NOW), false);
});

test("isFreshConfirmation: a date in the far future is not a fresh confirmation", () => {
  assert.equal(isFreshConfirmation({ email_confirmed_at: new Date(NOW + 10 * MIN).toISOString() }, NOW), false);
});

test("isFreshConfirmation defaults `now` to the current time", () => {
  assert.equal(isFreshConfirmation({ email_confirmed_at: new Date().toISOString() }), true);
  assert.equal(isFreshConfirmation({ email_confirmed_at: new Date(Date.now() - 10 * MIN).toISOString() }), false);
});

/* ---------------- sign-up events: wiring ---------------- */

/** The object literal passed as the second argument of `trackServer("<event>", {…})` calls in a source file. */
function trackServerCalls(src: string, event: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`trackServer\\(\\s*"${event}"\\s*,\\s*\\{`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      if (src[i] === "}") depth--;
      i++;
    }
    out.push(src.slice(re.lastIndex, i - 1));
  }
  return out;
}

test("login actions send signup_started for magic link and password, with only role, method and invite flag", () => {
  const src = read("app/login/actions.ts");
  const calls = trackServerCalls(src, "signup_started");
  assert.equal(calls.length, 2, "one call in requestMagicLink, one in signUpWithPassword");
  assert.ok(calls.some((c) => /method:\s*"magic_link"/.test(c)));
  assert.ok(calls.some((c) => /method:\s*"password"/.test(c)));
  for (const c of calls) {
    assert.match(c, /role_hint:/);
    assert.match(c, /has_invite:\s*next\.startsWith\("\/invite"\)/);
    assert.doesNotMatch(c, /email|birth|year|\bnext\s*[,}]/i, `nothing personal in: ${c}`);
  }
});

test("signup_started is only sent when an account is being created", () => {
  const src = read("app/login/actions.ts");
  const magic = src.slice(src.indexOf("export async function requestMagicLink"), src.indexOf("export type PasswordState"));
  assert.match(magic, /if \(signingUp\) \{\s*await trackServer\("signup_started"/, "guarded by signingUp");
  const pw = src.slice(src.indexOf("export async function signUpWithPassword"), src.indexOf("function alreadyExists"));
  assert.ok(pw.indexOf('trackServer("signup_started"') > pw.indexOf("identities"), "after the already-exists checks");
});

test("signup_completed goes through trackSignupIfNew, which applies the freshness rule", () => {
  const helper = read("lib/signup-events.ts");
  assert.match(helper, /^import "server-only";/m);
  assert.match(helper, /isFreshConfirmation\(user\)/);
  assert.match(helper, /trackServer\(\s*"signup_completed"/);
  assert.match(helper, /user\.id/, "the account id is the distinct id");
  const [call] = trackServerCalls(helper, "signup_completed");
  assert.doesNotMatch(call, /email|birth|\bnext\s*[,}]/i);
  assert.doesNotMatch(read("lib/signup-events-rules.ts"), /^import .*server-only/m, "the rule stays importable by tests");
});

test("the auth callback and completeSignIn both report a new sign-up", () => {
  const callback = read("app/auth/callback/route.ts");
  assert.match(callback, /trackSignupIfNew\(data\.user, type === "signup" \? "password" : "magic_link", next\)/);
  const confirm = read("app/auth/confirm/actions.ts");
  assert.match(confirm, /trackSignupIfNew\(data\.user, "magic_link", ""\)/);
});

/* ---------------- /privacy ---------------- */

const SECTION_IDS = ["short-version", "measure", "never", "signed-in", "performance", "choices", "processors", "retention", "changes"];

test("the privacy page exists with every section, each in the on-page list and with a heading", () => {
  const page = read("app/privacy/page.tsx");
  for (const id of SECTION_IDS) {
    assert.match(page, new RegExp(`<Section id="${id}"`), `section ${id}`);
    assert.match(page, new RegExp(`\\["${id}", "[^"]+"\\]`), `${id} listed in the on-page navigation`);
  }
  assert.equal((page.match(/<Section id=/g) ?? []).length, SECTION_IDS.length, "no section without a test");
  assert.match(page, /title: "Privacy"/);
  assert.match(page, /<h1 /);
});

test("the privacy page states the commitments it makes", () => {
  const page = read("app/privacy/page.tsx");
  assert.ok(page.includes("Global Privacy Control"));
  assert.ok(page.includes("Do Not Track"));
  assert.ok(page.includes("12 months"));
  for (const processor of ["PostHog", "Vercel", "Supabase", "Resend"]) assert.ok(page.includes(processor), processor);
  assert.ok(page.includes("Last updated: October 2026"), "dates are words, not numeric ranges (lineage guard)");
  for (const href of ["/data#method", "/account", "/glossary", "/release-notes"]) assert.ok(page.includes(`href="${href}`) || page.includes(`href="${href}"`), `links to ${href}`);
});

test("the privacy page has no fixed-width layout that would scroll sideways on a phone", () => {
  const page = read("app/privacy/page.tsx");
  assert.doesNotMatch(page, /\b(min-w|w)-\[\d+px\]|\bmin-w-\d|<table/, "no pixel widths or tables");
  assert.match(page, /px-4/, "16px side gutter");
});

test("the footer, the Data page's methods section, and the account page link to /privacy", () => {
  assert.match(read("components/layout/Footer.tsx"), /href="\/privacy"[^>]*>\s*Privacy\s*</);
  const data = read("app/data/page.tsx");
  assert.ok(data.slice(data.indexOf('<Section id="method"')).includes('href="/privacy"'), "inside the methods section");
  assert.match(read("app/account/page.tsx"), /href="\/privacy"/);
});

test("the monthly report template has the seven report headings and the observations list", () => {
  const tpl = read("data/reports/usage-template.md");
  for (const h of ["Traffic", "Engagement", "Funnels", "Retention", "Content", "Performance", "Errors"]) {
    assert.match(tpl, new RegExp(`^## \\d\\. ${h}$`, "m"), h);
  }
  assert.match(tpl, /^## Observations$/m);
  assert.match(tpl, /by hand/);
});
