/**
 * The session check's signing keys, bundled at build time (lib/auth-jwks.ts, scripts/fetch-jwks.mts;
 * specs/product/accounts.md "Checking the session without fetching the keys"). The verification tests run the real
 * @supabase/ssr server client (the one lib/supabase-server.ts and proxy.ts build) over a fake fetch, with a real ES256 token in its session
 * cookie, and count the requests it makes. Each test uses its own project URL: the library caches keys per storage
 * key, module-wide, so tests sharing one would see each other's cache. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { bundledJwks, getClaimsWithKeys, type Jwks } from "../lib/auth-jwks.ts";
import { jwksUrl, main as fetchJwks, publicKeys } from "../scripts/fetch-jwks.mts";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* A real ES256 key, token, and session cookie                         */
/* ------------------------------------------------------------------ */

const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");

async function signingKey(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwk = { kty: kty!, crv, x, y, kid, alg: "ES256", use: "sig", key_ops: ["verify"], ext: true };
  return { kid, privateKey: pair.privateKey, jwk };
}

async function token(key: { kid: string; privateKey: CryptoKey }, claims: Record<string, unknown>): Promise<string> {
  const head = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: key.kid }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A signed-in session as the cookie holds it, its access token expiring in `expiresIn` seconds. */
async function session(key: Awaited<ReturnType<typeof signingKey>>, expiresIn = 3600) {
  const exp = nowSeconds() + expiresIn;
  const access_token = await token(key, { sub: "user-1", email: "a@example.com", aal: "aal1", role: "authenticated", exp, iat: nowSeconds() });
  return { access_token, refresh_token: "refresh-1", token_type: "bearer", expires_in: expiresIn, expires_at: exp, user: { id: "user-1", email: "a@example.com" } };
}

type Call = { url: string; method: string };

/** The server client for project `ref` with `sess` in its cookie, over a fake fetch that serves `served` as the JWKS. */
function client(ref: string, sess: object, served: Jwks, refreshed?: object) {
  const calls: Call[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/auth/v1/.well-known/jwks.json")) return Response.json(served);
    if (url.includes("/auth/v1/token") && refreshed) return Response.json(refreshed);
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  };
  const cookies = [{ name: `sb-${ref}-auth-token`, value: `base64-${b64url(JSON.stringify(sess))}` }];
  const supabase = createServerClient(`https://${ref}.supabase.co`, "sb_publishable_test", {
    global: { fetch: fakeFetch as typeof fetch },
    cookies: { getAll: () => cookies, setAll: () => {} },
  });
  return { supabase, calls };
}

let projects = 0;
const freshRef = () => `testproject${++projects}${Date.now().toString(36)}`;

/* ------------------------------------------------------------------ */
/* Verification: requests made                                         */
/* ------------------------------------------------------------------ */

test("with the bundled keys, getClaims verifies the session's token without a single request", async () => {
  const key = await signingKey("kid-current");
  const { supabase, calls } = client(freshRef(), await session(key), { keys: [key.jwk] });
  const { data, error } = await getClaimsWithKeys(supabase.auth, { keys: [key.jwk] });
  assert.equal(error, null);
  assert.equal(data?.claims.sub, "user-1");
  assert.deepEqual(calls, []);
});

test("without them (the old call), a fresh instance fetches the key set once, then serves it from the library's cache", async () => {
  const key = await signingKey("kid-current");
  const ref = freshRef();
  const { supabase, calls } = client(ref, await session(key), { keys: [key.jwk] });
  const first = await supabase.auth.getClaims();
  assert.equal(first.data?.claims.sub, "user-1");
  assert.deepEqual(calls, [{ url: `https://${ref}.supabase.co/auth/v1/.well-known/jwks.json`, method: "GET" }]);
  // A second client on the same project (the next request on this instance) shares the module-wide cache.
  const again = client(ref, await session(key), { keys: [key.jwk] });
  assert.equal((await again.supabase.auth.getClaims()).data?.claims.sub, "user-1");
  assert.deepEqual(again.calls, []);
});

test("a key rotated in since the build (its kid not bundled) falls back to the library's fetch, and still verifies", async () => {
  const old = await signingKey("kid-old");
  const rotated = await signingKey("kid-new");
  const ref = freshRef();
  const { supabase, calls } = client(ref, await session(rotated), { keys: [old.jwk, rotated.jwk] });
  const { data, error } = await getClaimsWithKeys(supabase.auth, { keys: [old.jwk] });
  assert.equal(error, null, "a rotation never signs anyone out");
  assert.equal(data?.claims.sub, "user-1");
  assert.deepEqual(calls, [{ url: `https://${ref}.supabase.co/auth/v1/.well-known/jwks.json`, method: "GET" }]);
});

test("the bundled keys are trusted only for their own kid: a token signed by another key under that kid is refused", async () => {
  const real = await signingKey("kid-current");
  const forger = await signingKey("kid-current");
  const { supabase, calls } = client(freshRef(), await session(forger), { keys: [real.jwk] });
  const { data, error } = await getClaimsWithKeys(supabase.auth, { keys: [real.jwk] });
  assert.equal(data, null);
  assert.ok(error, "an invalid signature is an error, not claims");
  assert.deepEqual(calls, []);
});

test("an empty bundled set (a build without SUPABASE_URL) behaves exactly as the old call: one fetch", async () => {
  const key = await signingKey("kid-current");
  const { supabase, calls } = client(freshRef(), await session(key), { keys: [key.jwk] });
  assert.equal((await getClaimsWithKeys(supabase.auth, { keys: [] })).data?.claims.sub, "user-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/auth\/v1\/\.well-known\/jwks\.json$/);
});

test("a token within 90 seconds of expiry is refreshed first: that one request goes to the network even with the keys", async () => {
  const key = await signingKey("kid-current");
  const expiring = await session(key, 30);
  const fresh = await session(key, 3600);
  const { supabase, calls } = client(freshRef(), expiring, { keys: [key.jwk] }, fresh);
  const { data, error } = await getClaimsWithKeys(supabase.auth, { keys: [key.jwk] });
  assert.equal(error, null);
  assert.equal(data?.claims.sub, "user-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
  assert.equal(calls[0].method, "POST");
});

/* ------------------------------------------------------------------ */
/* lib/auth-jwks.ts and its callers                                    */
/* ------------------------------------------------------------------ */

test("bundledJwks() is the key set written at install or build time (an array, possibly empty)", () => {
  const onDisk = JSON.parse(readFileSync(join(ROOT, ".data", "auth", "jwks.json"), "utf8")) as Jwks;
  assert.ok(Array.isArray(bundledJwks().keys));
  assert.deepEqual(bundledJwks(), onDisk);
  for (const k of bundledJwks().keys) assert.ok(!("d" in k), "never a private key");
});

test("lib/auth-jwks.ts imports the file statically (inlined by the bundler, so proxy.ts gets it too, no file tracing)", () => {
  const source = readFileSync(join(ROOT, "lib", "auth-jwks.ts"), "utf8");
  assert.match(source, /^import bundled from "\.\.\/\.data\/auth\/jwks\.json" with \{ type: "json" \};$/m);
  assert.doesNotMatch(source, /node:fs|readFileSync/);
});

/** A code line (not a comment) calling `.getClaims(`. */
function callsGetClaims(line: string): boolean {
  const code = line.trim();
  if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return false;
  return /\.getClaims\(/.test(code);
}

/** Every `.getClaims(` call in the code that runs in the deploy, but the one inside lib/auth-jwks.ts. */
function bareGetClaimsCalls(): string[] {
  const out: string[] = [];
  const files = ["lib", "app", "components"]
    .flatMap((dir) => readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" }).map((f) => join(dir, f)))
    .filter((f) => /\.(ts|tsx)$/.test(f) && statSync(join(ROOT, f)).isFile())
    .concat("proxy.ts");
  for (const file of files) {
    if (file === join("lib", "auth-jwks.ts")) continue;
    readFileSync(join(ROOT, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (callsGetClaims(line)) out.push(`${file}:${i + 1}`);
      });
  }
  return out;
}

test("every session check passes the bundled keys: lib/auth.ts and proxy.ts go through getClaimsWithKeys", () => {
  assert.match(readFileSync(join(ROOT, "lib", "auth.ts"), "utf8"), /await getClaimsWithKeys\(supabase\.auth\)/);
  assert.match(readFileSync(join(ROOT, "proxy.ts"), "utf8"), /await getClaimsWithKeys\(supabase\.auth\)/);
  assert.deepEqual(bareGetClaimsCalls(), [], "call getClaimsWithKeys(supabase.auth) instead of supabase.auth.getClaims()");
});

test("the guard bites: a bare getClaims() call is found, a comment naming it is not", () => {
  assert.equal(callsGetClaims("  await supabase.auth.getClaims().catch(() => null);"), true);
  assert.equal(callsGetClaims("  const { data } = await client.auth.getClaims(token);"), true);
  assert.equal(callsGetClaims(" * both the page and the browser. It uses auth.getClaims(), which refreshes"), false);
  assert.equal(callsGetClaims("  // auth.getClaims() verifies the token"), false);
});

/* ------------------------------------------------------------------ */
/* scripts/fetch-jwks.mts                                              */
/* ------------------------------------------------------------------ */

const tempFile = () => join(mkdtempSync(join(tmpdir(), "fetch-jwks-")), "auth", "jwks.json");
const quiet = async <T,>(run: () => Promise<T>): Promise<T> => {
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    return await run();
  } finally {
    console.log = log;
    console.warn = warn;
  }
};

test("fetch-jwks writes the empty set without SUPABASE_URL, and makes no request", async () => {
  const file = tempFile();
  let requests = 0;
  const code = await quiet(() => fetchJwks([], {}, { file, fetch: async () => (requests++, Response.json({ keys: [] })) }));
  assert.equal(code, 0);
  assert.equal(requests, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { keys: [] });
});

test("fetch-jwks downloads the project's well-known key set and keeps only public asymmetric keys", async () => {
  const file = tempFile();
  const urls: string[] = [];
  const served = {
    keys: [
      { kty: "EC", kid: "ec-1", crv: "P-256", x: "x", y: "y", alg: "ES256", key_ops: ["verify"] },
      { kty: "RSA", kid: "rsa-1", n: "n", e: "AQAB", alg: "RS256", key_ops: ["verify"] },
      { kty: "oct", kid: "hs-1", k: "secret", alg: "HS256" },
      { kty: "EC", kid: "private-1", crv: "P-256", x: "x", y: "y", d: "private" },
      { kty: "EC", crv: "P-256", x: "x", y: "y" },
    ],
  };
  const fake = async (url: string) => (urls.push(url), Response.json(served));
  await quiet(() => fetchJwks([], { SUPABASE_URL: "https://abc.supabase.co/" }, { file, fetch: fake }));
  assert.deepEqual(urls, ["https://abc.supabase.co/auth/v1/.well-known/jwks.json"]);
  assert.deepEqual((JSON.parse(readFileSync(file, "utf8")) as Jwks).keys.map((k) => k.kid), ["ec-1", "rsa-1"]);
  assert.equal(jwksUrl("https://abc.supabase.co"), "https://abc.supabase.co/auth/v1/.well-known/jwks.json");
  assert.throws(() => publicKeys({ nope: true }), /no keys array/);
});

test("fetch-jwks never fails the build: a failed download keeps the file there, or writes the empty set", async () => {
  const failing = async () => new Response("down", { status: 503 });
  const fresh = tempFile();
  assert.equal(await quiet(() => fetchJwks([], { SUPABASE_URL: "https://abc.supabase.co" }, { file: fresh, fetch: failing })), 0);
  assert.deepEqual(JSON.parse(readFileSync(fresh, "utf8")), { keys: [] });

  const kept = tempFile();
  await quiet(() => fetchJwks([], { SUPABASE_URL: "https://abc.supabase.co" }, { file: kept, fetch: async () => Response.json({ keys: [{ kty: "EC", kid: "k1" }] }) }));
  assert.equal(await quiet(() => fetchJwks([], { SUPABASE_URL: "https://abc.supabase.co" }, { file: kept, fetch: failing })), 0);
  assert.deepEqual((JSON.parse(readFileSync(kept, "utf8")) as Jwks).keys.map((k) => k.kid), ["k1"]);
});

test("fetch-jwks --ensure (the postinstall) keeps a file already there without a request, and writes one when missing", async () => {
  const file = tempFile();
  let requests = 0;
  const fake = async () => (requests++, Response.json({ keys: [{ kty: "EC", kid: "k2" }] }));
  await quiet(() => fetchJwks(["--ensure"], { SUPABASE_URL: "https://abc.supabase.co" }, { file, fetch: fake }));
  assert.equal(requests, 1);
  assert.ok(existsSync(file));
  writeFileSync(file, JSON.stringify({ keys: [] }));
  await quiet(() => fetchJwks(["--ensure"], { SUPABASE_URL: "https://abc.supabase.co" }, { file, fetch: fake }));
  assert.equal(requests, 1);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { keys: [] });
});

test("package.json runs fetch-jwks in the prebuild and, with --ensure, in the postinstall", () => {
  const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  assert.match(scripts.prebuild, /scripts\/fetch-jwks\.mts(?! --ensure)/);
  assert.match(scripts.postinstall, /scripts\/fetch-jwks\.mts --ensure/);
});
