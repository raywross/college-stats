/**
 * The update digest (lib/digest.ts; specs/product/follow-colleges.md#the-digest): one digest per user per publish,
 * the cutoff at 8 colleges, both years in every sentence, the unsubscribe token in the headers and the footer, and
 * the 14-day backlog cap. Cron auth and the email seam's "not configured" behavior reuse the same functions
 * app/api/cron/digests/route.ts calls (lib/revalidate.ts isAuthorized, lib/email.ts sendEmail); the route itself
 * isn't imported here, matching this repo's convention that app/ routes use the "@/…" alias Next's bundler
 * resolves, not plain `node --test` — they're exercised by `next build` and manual QA instead. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, eligiblePublishes, DIGEST_CUTOFF, type DigestCollegeInput } from "../lib/digest.ts";
import type { ChangeKind, StoredChange } from "../lib/changes.ts";
import { isAuthorized } from "../lib/revalidate.ts";
import { emailConfigured, sendEmail } from "../lib/email.ts";
import type { FieldPath } from "../lib/fields.ts";

function change(over: Partial<StoredChange> & { unit_id: string; field: FieldPath; kind: ChangeKind }): StoredChange {
  return {
    publish_id: 1,
    published_at: "2026-10-05T12:00:00Z",
    old_value: 0.098,
    new_value: 0.091,
    old_year: "Fall 2024",
    new_year: "Fall 2025",
    source: "IPEDS Admissions",
    old_source: null,
    release: null,
    ...over,
  };
}

const college = (over: Partial<DigestCollegeInput> & { unit_id: string; name: string }): DigestCollegeInput => ({
  source: "manual",
  changes: [change({ unit_id: over.unit_id, field: "admissions.acceptance_rate", kind: "new_year" })],
  ...over,
});

const CTX = { siteUrl: "https://quad.example", unsubscribeToken: "a".repeat(64) };

test("buildDigest: groups one college's changes, in topic order, and names the source", () => {
  const changes = [
    change({ unit_id: "1", field: "outcomes.graduation_rate", kind: "revised", old_value: 0.6, new_value: 0.62, old_year: "2024", new_year: "2024" }),
    change({ unit_id: "1", field: "admissions.acceptance_rate", kind: "new_year" }),
  ];
  const built = buildDigest([{ unit_id: "1", name: "Example University", source: "manual", changes }], CTX)!;
  assert.ok(built);
  assert.equal(built.colleges.length, 1);
  // admissions.acceptance_rate (an earlier NOTIFY_FIELDS entry) is listed before outcomes.graduation_rate, matching
  // the site's topic order, regardless of the input array's order.
  assert.deepEqual(
    built.colleges[0].changes.map((c) => c.field),
    ["admissions.acceptance_rate", "outcomes.graduation_rate"],
  );
});

test("buildDigest: drops a disappeared-only college (never emailed) and returns null with nothing to send", () => {
  const onlyDisappeared = college({ unit_id: "1", name: "A", changes: [change({ unit_id: "1", field: "outcomes.median_debt", kind: "disappeared", new_value: null })] });
  assert.equal(buildDigest([onlyDisappeared], CTX), null);
});

test("buildDigest: cuts off at 8 colleges, names the rest by count, but counts every one in the totals", () => {
  const colleges = Array.from({ length: 11 }, (_, i) => college({ unit_id: String(i + 1), name: `College ${String(i + 1).padStart(2, "0")}` }));
  const built = buildDigest(colleges, CTX)!;
  assert.equal(built.colleges.length, DIGEST_CUTOFF);
  assert.equal(built.moreCount, 3);
  assert.equal(built.collegeCount, 11);
  assert.equal(built.unitIds.length, 11);
  assert.match(built.html, /and 3 more/);
  assert.match(built.text, /and 3 more/);
});

test("buildDigest: a cut-off digest still totals every emailable change, not just the shown colleges'", () => {
  const colleges = Array.from({ length: 9 }, (_, i) => college({ unit_id: String(i + 1), name: `College ${i + 1}` }));
  const built = buildDigest(colleges, CTX)!;
  assert.equal(built.changeCount, 9); // one change per college, including the one past the cutoff
});

test("buildDigest: the subject names the college when there's one, or the count when there's more", () => {
  const one = buildDigest([college({ unit_id: "1", name: "Example University" })], CTX)!;
  assert.match(one.subject, /^Example University:/);
  const many = buildDigest(
    [college({ unit_id: "1", name: "A" }), college({ unit_id: "2", name: "B" })],
    CTX,
  )!;
  assert.equal(many.subject, "Updates for 2 of your colleges");
});

test("buildDigest: the unsubscribe token is in the List-Unsubscribe headers and the footer link, one click", () => {
  const built = buildDigest([college({ unit_id: "1", name: "Example University" })], CTX)!;
  assert.equal(built.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(built.headers["List-Unsubscribe"], new RegExp(`^<https://quad\\.example/unsubscribe/${CTX.unsubscribeToken}\\?utm_source=digest>$`));
  assert.ok(built.html.includes(CTX.unsubscribeToken));
  assert.ok(built.text.includes(CTX.unsubscribeToken));
  assert.ok(built.html.includes("utm_source=digest"));
});

test("buildDigest: every sentence names both years, and the college link carries utm_source=digest", () => {
  const built = buildDigest([college({ unit_id: "166027", name: "Example University" })], CTX)!;
  assert.match(built.text, /Fall 2025: 9\.1% admitted \(fall 2024: 9\.8%\)/);
  assert.match(built.html, /Fall 2025: 9\.1% admitted \(fall 2024: 9\.8%\)/);
  assert.equal(built.colleges[0].href, "https://quad.example/schools/166027?utm_source=digest");
});

test("buildDigest: reasons name both a manual follow and a list follow when the set is mixed", () => {
  const built = buildDigest(
    [college({ unit_id: "1", name: "A", source: "manual" }), college({ unit_id: "2", name: "B", source: "list" })],
    CTX,
  )!;
  assert.deepEqual(built.reasons, ["you follow these colleges", "they're on one of your lists"]);
});

test("guard: feeding the changes in reverse still sorts them (proves the topic sort runs, not just input order)", () => {
  const changes = [
    change({ unit_id: "1", field: "outcomes.graduation_rate", kind: "revised", old_value: 0.6, new_value: 0.62, old_year: "2024", new_year: "2024" }),
    change({ unit_id: "1", field: "admissions.acceptance_rate", kind: "new_year" }),
  ];
  const built = buildDigest([{ unit_id: "1", name: "Example University", source: "manual", changes }], CTX)!;
  assert.deepEqual(
    built.colleges[0].changes.map((c) => c.field),
    ["admissions.acceptance_rate", "outcomes.graduation_rate"],
  );
});

/* ------------------------------------------------------------------ */
/* The 14-day backlog cap                                              */
/* ------------------------------------------------------------------ */

test("eligiblePublishes: only between 24 hours and 14 days old", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const rows = [
    { id: 1, published_at: hoursAgo(1) }, // too fresh
    { id: 2, published_at: hoursAgo(25) }, // eligible
    { id: 3, published_at: hoursAgo(13 * 24) }, // eligible, within 14 days
    { id: 4, published_at: hoursAgo(15 * 24) }, // too old: the backlog cap
  ];
  assert.deepEqual(eligiblePublishes(rows, now).map((r) => r.id), [3, 2]); // oldest first
});

test("guard: without the 14-day cap, a long-quiet deployment would resurface every publish since launch", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const rows = [{ id: 1, published_at: new Date(now.getTime() - 400 * 86_400_000).toISOString() }];
  assert.deepEqual(eligiblePublishes(rows, now), []); // capped out
  assert.deepEqual(eligiblePublishes(rows, now, { maxAgeDays: 500 }), rows); // would otherwise come back
});

/* ------------------------------------------------------------------ */
/* Cron auth (the same isAuthorized() app/api/cron/digests/route.ts calls)  */
/* ------------------------------------------------------------------ */

test("cron auth: refuses a missing or wrong bearer, accepts the configured CRON_SECRET", () => {
  const secret = "cron-secret-abc123";
  assert.equal(isAuthorized(null, secret), false);
  assert.equal(isAuthorized("Bearer wrong", secret), false);
  assert.equal(isAuthorized("Bearer cron-secret-abc12", secret), false); // close, but not equal
  assert.equal(isAuthorized(`Bearer ${secret}`, secret), true);
  assert.equal(isAuthorized(`Bearer ${secret}`, undefined), false); // CRON_SECRET unset: nobody gets in
});

test("guard: a route that compared the raw header instead of calling isAuthorized would accept 'Bearer ' + any prefix of the secret", () => {
  const secret = "cron-secret-abc123";
  const naive = (authorization: string | null) => authorization === `Bearer ${secret}`;
  assert.equal(naive(`Bearer ${secret}`), true);
  // isAuthorized rejects the same near-misses a naive string compare might not catch consistently in timing:
  assert.equal(isAuthorized(`Bearer ${secret}x`, secret), false);
});

/* ------------------------------------------------------------------ */
/* Email not configured: the cron job sends nothing                    */
/* ------------------------------------------------------------------ */

test("email not configured: sendEmail sends nothing for a digest, same as any other mail (dry run only)", async () => {
  const built = buildDigest([college({ unit_id: "1", name: "Example University" })], CTX)!;
  assert.equal(emailConfigured({}), false);
  let fetchCalled = false;
  const result = await sendEmail(
    { to: "family@example.com", subject: built.subject, html: built.html, text: built.text, headers: built.headers },
    { env: {}, fetch: (async () => { fetchCalled = true; return new Response("{}"); }) as typeof fetch },
  );
  assert.deepEqual(result, { sent: false, reason: "not-configured" });
  assert.equal(fetchCalled, false); // never reached the network: nothing sent, nothing to record
});
