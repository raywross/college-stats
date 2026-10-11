/**
 * Quad's estimate, the interface and the endpoint (lib/chances/estimate.ts, estimate-request.ts, rate-limit.ts,
 * app/api/estimate/route.ts; specs/chances/estimate.md): the contract over the real dataset, the baseline fallback
 * when the model throws, counterfactuals ("this score", "this course added"), input validation and the signed-out /
 * signed-in limits, the per-IP and per-user token buckets, a response that carries only the contract's fields (never
 * the snapshot's detail), and the seams: the snapshot's default estimator and the lists' other "applied" path. Each
 * guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

const ROOT = join(import.meta.dirname, "..");

// estimate.ts is server code written for Next.js: `import "server-only"`, `@/` paths, and extensionless relative
// imports. Stand in an empty module for the first and resolve the other two the way the bundler does.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const { estimate, estimateContext, estimateMany, estimateWithDetail, MODEL_VERSION, appliedEstimator } = await import("../lib/chances/estimate.ts");
const { BASELINE_VERSION } = await import("../lib/chances/baseline.ts");
const { MAX_COLLEGES, parseEstimateRequest, publicResult, requestCost, RESULT_FIELDS, sanitizeEstimateStudent, withCounterfactual } = await import("../lib/chances/estimate-request.ts");
const { clientIp, createLimiter, ESTIMATE_LIMITS, take, TokenBuckets } = await import("../lib/chances/rate-limit.ts");
const { isNoteKey } = await import("../lib/chances/notes.ts");
type EstimateStudent = import("../lib/chances/types.ts").EstimateStudent;
type EstimateResult = import("../lib/chances/types.ts").EstimateResult;
type CourseEntry = import("../lib/chances/types.ts").CourseEntry;
type School = import("../lib/types.ts").School;

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

function student(o: Partial<EstimateStudent> = {}): EstimateStudent {
  const gpa = o.gpa ?? null;
  return { gpa, gpaScale: "4.0", gpaRange: gpa !== null ? [gpa, gpa] : null, test: null, satMath: null, actMath: null, classRankPercentile: null, courses: [], state: null, majors: [], round: null, highSchoolId: null, ...o };
}
let courseId = 0;
const ap = (key: string, subject: CourseEntry["subject"]): CourseEntry => ({ id: `c${++courseId}`, kind: "ap", key, name: null, subject, year: 11, status: "taken", grades: { s1: null, s2: null, final: "A" }, exam: null });

const PURDUE = "243780";
const GEORGIA_TECH = "139755";
const ELON = "198516";

/* ------------------------------------------------------------------ */
/* The contract, over the real dataset                                 */
/* ------------------------------------------------------------------ */

test("estimateMany: one result per known college, each exactly the contract's fields, notes from the catalog", async () => {
  const s = student({ gpa: 3.85, test: { kind: "sat", score: 1300 }, state: "IN" });
  const ctx = await estimateContext(s);
  const results = estimateMany(s, [PURDUE, GEORGIA_TECH, ELON, "999999", PURDUE], ctx);
  assert.deepEqual(Object.keys(results).sort(), [PURDUE, GEORGIA_TECH, ELON].sort(), "unknown ids are left out, duplicates once");
  for (const [id, r] of Object.entries(results)) {
    assert.deepEqual(Object.keys(r), [...RESULT_FIELDS], id);
    assert.equal(r.unitId, id);
    assert.equal(r.modelVersion, MODEL_VERSION);
    for (const n of r.notes) assert.ok(isNoteKey(n.key), n.key);
    assert.deepEqual(publicResult(r), r, "already public");
  }
  assert.equal(results[GEORGIA_TECH].label, "reach-for-everyone", "an Indiana student at Georgia Tech's out-of-state rate");
  assert.equal(estimate({ student: s, unitId: "999999" }, ctx).group, null, "a college the dataset doesn't have");
});

test("the model falls back to the open baseline only when it throws, and says so in the log", async () => {
  const s = student({ test: { kind: "sat", score: 1450 } });
  const real = await estimateContext(s);
  const school = real.schoolById(ELON)!;
  // A record whose curated parts can't be read: the model throws, the baseline (which reads only the standing slice) answers.
  const broken = new Proxy(school, { get: (t, k) => (k === "reported" ? (() => { throw new Error("unreadable"); })() : Reflect.get(t, k)) }) as School;
  const ctx = { ...real, schoolById: (id: string) => (id === ELON ? broken : real.schoolById(id)), standingFor: () => real.standingFor(school) };
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    const { result, detail } = estimateWithDetail({ student: s, unitId: ELON }, ctx);
    assert.equal(result.modelVersion, BASELINE_VERSION);
    assert.equal(detail, null);
    assert.ok(result.group !== undefined);
    assert.equal(errors.length, 1);
    assert.match(String((errors[0] as unknown[])[0]), /model failed for 198516/);
  } finally {
    console.error = original;
  }
  const ok = estimateWithDetail({ student: s, unitId: ELON }, real);
  assert.equal(ok.result.modelVersion, MODEL_VERSION);
  assert.ok(ok.detail && "without" in ok.detail);
});

test("the snapshot's estimator returns the result and the method's detail", async () => {
  const r = await appliedEstimator({ student: student({ gpa: 3.85, test: { kind: "sat", score: 1300 }, state: "IN" }), unitId: PURDUE });
  assert.ok(r);
  assert.equal(r.result.unitId, PURDUE);
  assert.equal(r.detail?.baseRateKind, "residency");
  assert.ok(r.detail?.without && "residency" in r.detail.without);
});

/* ------------------------------------------------------------------ */
/* Counterfactuals                                                     */
/* ------------------------------------------------------------------ */

test("counterfactual score: the move-up's score reaches the group it names", async () => {
  const s = student({ gpa: 3.85, test: { kind: "sat", score: 1150 } });
  const ctx = await estimateContext(s);
  const now = estimate({ student: s, unitId: PURDUE }, ctx);
  assert.ok(now.moveUp, "a retake could move Purdue");
  const then = estimate({ student: withCounterfactual(s, { score: now.moveUp.score }), unitId: PURDUE }, ctx);
  assert.equal(then.group, now.moveUp.to);
  const short = estimate({ student: withCounterfactual(s, { score: now.moveUp.score - 10 }), unitId: PURDUE }, ctx);
  assert.equal(short.group, now.group, "ten points fewer doesn't");
});

test("counterfactual course: adding the course that makes the schedule read 'most' raises a crowded college", async () => {
  const six = [ap("ap_english_language", "english"), ap("ap_calculus_ab", "math"), ap("ap_biology", "science"), ap("ap_us_history", "history"), ap("ap_english_literature", "english"), ap("ap_chemistry", "science")];
  const s = student({ gpa: 3.9, courses: six, highSchoolId: null });
  const real = await estimateContext(s);
  const ctx = { ...real, offering: { apCount: 10, apKeys: null, ib: null, dual: null, source: "profile" as const, field: "detail.ap_courses" }, linked: true };
  const before = estimate({ student: s, unitId: ELON }, ctx);
  const added = withCounterfactual(s, { addCourse: ap("ap_calculus_bc", "math") });
  assert.equal(added.courses.length, 7);
  const after = estimate({ student: added, unitId: ELON }, ctx);
  assert.equal(before.group, "target");
  assert.equal(after.group, "likely");
  assert.equal(withCounterfactual(added, { addCourse: { ...added.courses[6], status: "planned" } }).courses.length, 7, "the same row replaces itself");
  assert.equal(withCounterfactual(s, null), s);
});

/* ------------------------------------------------------------------ */
/* Input validation and limits                                         */
/* ------------------------------------------------------------------ */

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(100000 + i));

test("requests: a JSON object with college ids; signed out up to 20, signed in up to 25; more is refused, not trimmed", () => {
  assert.equal(MAX_COLLEGES.signedOut, 20);
  assert.equal(MAX_COLLEGES.signedIn, 25);
  assert.equal(parseEstimateRequest(null, { signedIn: false }).ok, false);
  assert.equal(parseEstimateRequest({ student: {} }, { signedIn: false }).ok, false);
  assert.equal(parseEstimateRequest({ unitIds: ["x", 12] }, { signedIn: false }).ok, false, "no valid id");
  assert.equal(parseEstimateRequest({ unitIds: ids(20) }, { signedIn: false }).ok, true);
  const tooMany = parseEstimateRequest({ unitIds: ids(21) }, { signedIn: false });
  assert.equal(tooMany.ok, false);
  assert.match(!tooMany.ok ? tooMany.message : "", /at most 20.*sign in/);
  assert.equal(parseEstimateRequest({ unitIds: ids(25) }, { signedIn: true }).ok, true);
  assert.equal(parseEstimateRequest({ unitIds: ids(26) }, { signedIn: true }).ok, false);
  const dup = parseEstimateRequest({ unitIds: [PURDUE, PURDUE, "bad", ELON] }, { signedIn: false });
  assert.ok(dup.ok && dup.request.unitIds.length === 2);
});

test("the student is sanitized: out-of-range numbers, unknown majors, malformed courses, and bad states are dropped", () => {
  const s = sanitizeEstimateStudent({
    gpa: 9,
    gpaScale: "7.0",
    gpaRange: [3.9, 3.1],
    test: { kind: "sat", score: 2000 },
    satMath: 650,
    actMath: 99,
    classRankPercentile: 0,
    courses: [{ id: "a", kind: "ap", key: "ap_not_a_course", subject: "math", year: 11, status: "taken", grades: { s1: null, s2: null, final: "A" }, exam: null }, "junk"],
    state: "in",
    majors: ["14", "99", "undecided", "14", "11", "52"],
    round: "sometime",
    highSchoolId: "<script>",
    practice: "yes",
    detail: { position: "above" },
  });
  assert.equal(s.gpa, null);
  assert.equal(s.gpaScale, "4.0");
  assert.equal(s.gpaRange, null);
  assert.equal(s.test, null);
  assert.equal(s.satMath, 650);
  assert.equal(s.actMath, null);
  assert.equal(s.classRankPercentile, null);
  assert.deepEqual(s.courses, []);
  assert.equal(s.state, "IN");
  assert.deepEqual(s.majors, ["14", "undecided", "11"]);
  assert.equal(s.round, null);
  assert.equal(s.highSchoolId, null);
  assert.equal(s.practice, false);
  assert.ok(!("detail" in s));
  assert.deepEqual(sanitizeEstimateStudent({ test: { kind: "act", score: 31 }, state: "OUTSIDE_US", gpa: 3.82, gpaRange: [3.82, 3.82] }).test, { kind: "act", score: 31 });
});

test("counterfactuals are validated: a score needs a test and the test's range; a course must pass the course sanitizer", () => {
  const base = { unitIds: [PURDUE], student: { test: { kind: "sat", score: 1300 } } };
  const ok = parseEstimateRequest({ ...base, counterfactual: { score: 1360 } }, { signedIn: false });
  assert.ok(ok.ok && ok.request.counterfactual?.score === 1360);
  assert.equal(parseEstimateRequest({ ...base, counterfactual: { score: 1700 } }, { signedIn: false }).ok, false);
  assert.equal(parseEstimateRequest({ unitIds: [PURDUE], student: {}, counterfactual: { score: 1300 } }, { signedIn: false }).ok, false);
  assert.equal(parseEstimateRequest({ ...base, counterfactual: { addCourse: { kind: "ap", key: "nope" } } }, { signedIn: false }).ok, false);
  const course = parseEstimateRequest({ ...base, counterfactual: { addCourse: { id: "n1", kind: "ap", key: "ap_calculus_bc", name: null, subject: "math", year: 12, status: "planned", grades: { s1: null, s2: null, final: null }, exam: null } } }, { signedIn: false });
  assert.ok(course.ok && course.request.counterfactual?.addCourse?.key === "ap_calculus_bc");
  assert.equal(parseEstimateRequest({ ...base, counterfactual: "x" }, { signedIn: false }).ok, false);
});

test("the limiter: a burst, then refused with a wait; refills with time; both buckets must hold enough and neither is spent otherwise", () => {
  const limiter = createLimiter({ ip: { capacity: 3, refillPerSecond: 1 }, user: { capacity: 2, refillPerSecond: 0.5 } });
  const t0 = 1_000_000;
  const who = { ip: "1.2.3.4", userId: null };
  assert.ok(take(limiter, who, 1, t0).ok);
  assert.ok(take(limiter, who, 2, t0).ok);
  const refused = take(limiter, who, 1, t0);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.retryAfter, 1);
  assert.ok(take(limiter, who, 1, t0 + 1000).ok, "a second later there's a token again");
  assert.ok(take(limiter, { ip: "5.6.7.8", userId: null }, 3, t0).ok, "another IP has its own bucket");

  const signedIn = { ip: "9.9.9.9", userId: "u1" };
  assert.ok(take(limiter, signedIn, 2, t0).ok);
  const userEmpty = take(limiter, signedIn, 1, t0);
  assert.equal(userEmpty.ok, false, "the user's bucket is empty though the IP's isn't");
  assert.equal(limiter.ip.available("9.9.9.9", t0), 1, "nothing was spent from the IP when the user was refused");
  assert.ok(take(limiter, { ip: "8.8.8.8", userId: "u1" }, 1, t0 + 2000).ok, "the user's bucket follows them to another IP, refilled");

  const b = new TokenBuckets({ capacity: 5, refillPerSecond: 1 });
  b.spend("k", 5, 0);
  assert.equal(b.available("k", 10_000), 5, "never more than the capacity");
  assert.ok(ESTIMATE_LIMITS.ip.capacity >= requestCost(ids(20)) * 10, "a signed-out list can re-sort many times in a burst");
});

test("request cost grows with the colleges asked about; the caller's IP comes from the proxy header", () => {
  assert.equal(requestCost(ids(1)), 1);
  assert.equal(requestCost(ids(5)), 1);
  assert.equal(requestCost(ids(6)), 2);
  assert.equal(requestCost(ids(20)), 4);
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.equal(clientIp(h({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })), "203.0.113.5");
  assert.equal(clientIp(h({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(clientIp(h({})), "unknown");
});

/* ------------------------------------------------------------------ */
/* Responses carry only the contract                                   */
/* ------------------------------------------------------------------ */

const INTERNAL = /"(detail|baseRate|baseRateKind|crowded|rigorReading|without|positions|scorePosition|gpaSlot|threshold|weight)"/;

test("a response never includes the snapshot's detail or other internals, and keeps only catalog notes", () => {
  const leaky = {
    unitId: PURDUE,
    group: "likely",
    label: null,
    used: ["gpa", "made_up"],
    missing: [],
    facts: ["admissions.acceptance_rate", 5],
    notes: [
      { key: "estimate.open_admission", values: { secret: { nested: 1 }, ok: "x" } },
      { key: "free text the model made up", values: {} },
    ],
    send: "send",
    moveUp: { points: 20, to: "target", score: 1320, cutoff: 0.6 },
    modelVersion: MODEL_VERSION,
    detail: { position: "in", baseRate: 0.71, without: { residency: "target" } },
    crowded: true,
  } as unknown as EstimateResult;
  // The guard catches the leak before cleaning...
  assert.match(JSON.stringify(leaky), INTERNAL);
  // ...and the cleaned result has none of it.
  const clean = publicResult(leaky);
  assert.doesNotMatch(JSON.stringify(clean), INTERNAL);
  assert.deepEqual(Object.keys(clean), [...RESULT_FIELDS]);
  assert.deepEqual(clean.used, ["gpa"]);
  assert.deepEqual(clean.facts, ["admissions.acceptance_rate"]);
  assert.deepEqual(clean.notes, [{ key: "estimate.open_admission", values: { ok: "x" } }]);
  assert.deepEqual(clean.moveUp, { points: 20, to: "target", score: 1320 });
});

test("the route answers with publicResult only, never the model or the detail function", () => {
  const route = read("app", "api", "estimate", "route.ts");
  const ok = (src: string) => /publicResult\(/.test(src) && !/estimateWithDetail|modelEstimate|chances\/model|\.detail\b/.test(src);
  assert.ok(ok(route));
  assert.equal(ok(route.replace("publicResult(r)", "r")), false, "a route that skips publicResult fails the check");
  assert.equal(ok(`${route}\nimport { modelEstimateWithDetail } from "@/lib/chances/model";`), false, "one that reaches for the model fails it");
  assert.match(route, /signedIn: user !== null/);
  assert.match(route, /take\(limiter/);
  assert.match(route, /"Cache-Control": "no-store"/);
});

test("results from the real estimate pass through publicResult unchanged and with no internals", async () => {
  const s = student({ gpa: 3.9, classRankPercentile: 10, test: { kind: "sat", score: 1250 }, state: "NC", majors: ["14"] });
  const ctx = await estimateContext(s);
  const { result, detail } = estimateWithDetail({ student: s, unitId: ELON }, ctx);
  assert.ok(detail, "the detail exists on the server");
  const sent = JSON.stringify({ results: { [ELON]: publicResult(result) } });
  assert.doesNotMatch(sent, INTERNAL);
});

/* ------------------------------------------------------------------ */
/* Seams                                                               */
/* ------------------------------------------------------------------ */

test("the snapshot's default estimator is Quad's estimate, and the lists' applied path records a snapshot too", () => {
  assert.match(read("lib", "chances", "snapshot-deps.ts"), /estimate: AppliedEstimator \| null = appliedEstimator/);
  const lists = read("lib", "lists.ts");
  const setStatus = lists.slice(lists.indexOf("export async function setItemStatus"), lists.indexOf("export async function setOutcome"));
  assert.match(setStatus, /status === "applied"/);
  assert.match(setStatus, /after\(\(\) => snapshotOnApplied\(itemId, snapshotDeps\(supabase\)\)\)/);
});

test("the planner reads estimates computed on the server or fetched from the endpoint, never the model", () => {
  const view = read("lib", "planner", "plan-view.ts");
  assert.doesNotMatch(view, /standingFor\(|scoreToMoveUp\(|chances\/model|chances\/estimate"/);
  assert.match(read("lib", "planner", "load.ts"), /planEstimates\(/);
  assert.match(read("lib", "planner", "store-plan.ts"), /planEstimates\(/);
  for (const f of ["components/planner/NumbersForm.tsx", "components/planner/SignedOutPlan.tsx"]) assert.match(read(f), /useEstimates\(/, f);
  const hook = read("components", "planner", "useEstimates.ts");
  assert.match(hook, /fetch\("\/api\/estimate"/);
  assert.match(hook, /ESTIMATE_DEBOUNCE_MS = 400/);
});
