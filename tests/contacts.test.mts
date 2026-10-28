/**
 * The site's email addresses (lib/contacts.ts; specs/supabase.md "Email addresses"): one module names them, every
 * contact on the site is one of them, and every app email replies to support. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADVISOR_EMAIL, DATA_EMAIL, EMAIL_DOMAIN, HELLO_EMAIL, mailto, PRIVACY_EMAIL, SUPPORT_EMAIL } from "../lib/contacts.ts";
import { BRAND_REMOVAL_CONTACT, BRAND_REMOVAL_ISSUE } from "../lib/brand.ts";
import { sendEmail } from "../lib/email.ts";

const ROOT = join(import.meta.dirname, "..");

test("every address is on the site's domain, and mailto encodes its subject", () => {
  for (const a of [SUPPORT_EMAIL, HELLO_EMAIL, PRIVACY_EMAIL, DATA_EMAIL, ADVISOR_EMAIL]) assert.ok(a.endsWith(`@${EMAIL_DOMAIN}`), a);
  assert.equal(mailto(HELLO_EMAIL), `mailto:${HELLO_EMAIL}`);
  assert.equal(mailto(HELLO_EMAIL, { subject: "Counselor access to Quad" }), `mailto:${HELLO_EMAIL}?subject=Counselor%20access%20to%20Quad`);
  assert.match(mailto(DATA_EMAIL, { subject: "a", body: "x:\ny:" }), /^mailto:data@usequad\.app\?subject=a&body=x%3A%0Ay%3A$/);
});

test("the mark-removal and counselor contacts are emails, with the issue form kept as the second route", () => {
  assert.ok(BRAND_REMOVAL_CONTACT.startsWith(`mailto:${DATA_EMAIL}?`), BRAND_REMOVAL_CONTACT);
  assert.ok(BRAND_REMOVAL_ISSUE.startsWith("https://github.com/raywross/college-stats/issues/new?"), BRAND_REMOVAL_ISSUE);
  // components/advisor/links.ts imports with Next's `@/` alias, which plain node can't resolve, so read its source.
  const links = readFileSync(join(ROOT, "components", "advisor", "links.ts"), "utf8");
  assert.match(links, /COUNSELOR_CONTACT = mailto\(HELLO_EMAIL,/);
  assert.ok(!/issues\/new/.test(links), "the counselor line no longer points at a GitHub issue");
});

test("no page or component spells an address itself; they all come from lib/contacts.ts", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSyncSafe(dir)) {
      const path = join(dir, entry);
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      if (statIsDir(path)) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith(join("lib", "contacts.ts"))) {
        const text = readFileSync(path, "utf8");
        for (const m of text.matchAll(/[a-z]+@usequad\.app/g)) {
          // Comments may mention an address; code and JSX may not.
          const line = text.slice(text.lastIndexOf("\n", m.index) + 1, text.indexOf("\n", m.index));
          if (!/^\s*(\/\/|\*|\/\*)/.test(line)) offenders.push(`${path.slice(ROOT.length + 1)}: ${m[0]}`);
        }
      }
    }
  };
  for (const top of ["app", "components", "lib"]) walk(join(ROOT, top));
  assert.deepEqual(offenders, []);
});

test("sendEmail replies to support unless the message says otherwise", async () => {
  const env = { RESEND_API_KEY: "re_test", EMAIL_FROM: "Quad Advisor <advisor@usequad.app>" };
  const bodies: Record<string, unknown>[] = [];
  const ok = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const msg = { to: "a@b.c", subject: "s", html: "<p>h</p>", text: "t" };
  await sendEmail(msg, { env, fetch: ok, log: () => {} });
  assert.equal(bodies[0].reply_to, SUPPORT_EMAIL);
  await sendEmail({ ...msg, replyTo: PRIVACY_EMAIL }, { env, fetch: ok, log: () => {} });
  assert.equal(bodies[1].reply_to, PRIVACY_EMAIL);
});

import { readdirSync, statSync } from "node:fs";
function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
function statIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
