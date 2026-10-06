/**
 * One profile run over a list of schools: discover (./discover.mts) → extract (./extract.mts, Haiku) → check
 * (./checks.mts) → one escalation re-read (Sonnet) only when a failing field is one a re-read can fix, as the
 * college-reported engine does → a detail for the passing fields, review items for the rest. Every model call is held
 * to the spend cap (./budget.mts); when the next call wouldn't fit, the run stops and the schools left are recorded as
 * not run. No file I/O here: the script (scripts/sync-hs-profiles.mts) reads and writes.
 */
import type { HighSchoolDetail } from "../../../../lib/high-school-types.ts";
import { validateHighSchoolDetail } from "../../../../lib/high-school-core.ts";
import type { ModelClient } from "../../college-reported/models.mts";
import { SpendCap, SpendCapReached } from "./budget.mts";
import { assessProfile, parseNum, type Assessment, type CheckFailure, type CollegeReview } from "./checks.mts";
import { discoverProfile, type DiscoverHttp, type Found, type DiscoverSchool, type FoundVia, type HostKind, type ProfileRecipe } from "./discover.mts";
import { extractProfile, PROFILE_FIELDS, PROFILE_MODELS, type ProfileAnswer, type ProfileField } from "./extract.mts";
import type { CollegeIndex } from "./match.mts";
import type { KeyValues } from "./score.mts";

export interface RunSchool extends DiscoverSchool {
  grade12: number | null;
}

export interface SchoolResult {
  id: string;
  status: "published" | "failed-checks" | "not-found" | "blocked" | "unchanged" | "not-run" | "error";
  /** Profile candidates robots.txt disallows (status "blocked"). */
  blocked?: string[];
  found_via?: FoundVia;
  host_kind?: HostKind;
  url?: string;
  format?: "pdf" | "html";
  pages?: number;
  edition?: string | null;
  passed?: ProfileField[];
  withheld?: ProfileField[];
  escalated?: boolean;
  match?: Assessment["match"];
  cost_usd: number;
  ms: number;
  requests: number;
  error?: string;
  /** The extraction before checks, for scoring against the answer key. */
  extracted?: KeyValues;
}

export interface HsReviewItem {
  id: string;
  name: string;
  url: string | null;
  edition: string | null;
  field: ProfileField | "document" | "matriculation";
  check: CheckFailure["check"] | CollegeReview["check"];
  detail: string;
  names?: CollegeReview["names"];
  queued: string;
  run: string;
}

export interface RunDeps {
  http: DiscoverHttp;
  client?: ModelClient;
  cap: SpendCap;
  index: CollegeIndex;
  schoolIds?: ReadonlySet<string>;
  collegeIds?: ReadonlySet<string>;
  today: string;
  run: string;
  log: (m: string) => void;
  now?: () => number;
  seeds?: Record<string, string[]>;
  /** Discovery only, no extraction (no client needed). */
  discoverOnly?: boolean;
  /** Free discovery steps only (no search or picker). */
  free?: boolean;
  /** Re-extract a known profile even when unchanged. */
  force?: boolean;
  minEditionStart?: number;
  /** Called with each confirmed document (the script caches its bytes for the answer key and re-reads). */
  onFound?: (s: RunSchool, found: Found) => void;
  /** Schools run at once (default 1). */
  concurrency?: number;
}

export interface RunOutput {
  results: SchoolResult[];
  recipes: Record<string, ProfileRecipe>;
  details: HighSchoolDetail[];
  review: HsReviewItem[];
  stopped: string | null;
}

/** Checks a re-read can help with (the engine escalates only where a model can help). */
const ESCALATE: ReadonlySet<CheckFailure["check"]> = new Set(["quote", "distribution-sum", "count-bound", "scale-kind", "names", "range", "plausible"]);

export function escalatableFields(a: Assessment): ProfileField[] {
  return [...new Set(a.failures.filter((f) => f.field !== "document" && ESCALATE.has(f.check)).map((f) => f.field as ProfileField))];
}

/** The base answer with the escalated answer's values for `fields` (a field the re-read left out is removed). */
export function mergeAnswers(base: ProfileAnswer, esc: ProfileAnswer, fields: readonly ProfileField[]): ProfileAnswer {
  const out: ProfileAnswer = { ...base };
  for (const f of fields) {
    if (esc[f] === undefined) delete out[f];
    else (out as Record<string, unknown>)[f] = esc[f];
  }
  return out;
}

/** A raw answer as comparable values (before checks), for the answer key. */
export function answerValues(a: ProfileAnswer): KeyValues {
  const pair = (s?: { low: string; high: string }): [number, number] | null => {
    const lo = parseNum(s?.low);
    const hi = parseNum(s?.high);
    return lo !== null && hi !== null ? [lo, hi] : null;
  };
  let dist: KeyValues["gpa_distribution"] = null;
  if (a.gpa_distribution?.bands?.length) {
    const nums = a.gpa_distribution.bands.map((b) => parseNum(b.v) ?? 0);
    const total = nums.reduce((x, y) => x + y, 0);
    dist = a.gpa_distribution.bands.map((b, i) => ({
      band: b.band,
      share: a.gpa_distribution!.basis === "percent" ? nums[i] / 100 : total ? nums[i] / total : 0,
    }));
  }
  return {
    class_size: parseNum(a.class_size?.v),
    gpa_scale: a.gpa_scale ? { kind: a.gpa_scale.kind, max: parseNum(a.gpa_scale.max), weighted: !!a.gpa_scale.weighted } : null,
    gpa_distribution: dist,
    ap_courses: a.ap_courses?.names?.length ? a.ap_courses.names : null,
    ib_courses: a.ib_courses?.names?.length ? a.ib_courses.names : null,
    sat_mid50: pair(a.sat_mid50),
    act_mid50: pair(a.act_mid50),
    matriculation: a.matriculation?.entries?.length
      ? { classes: a.matriculation.classes, entries: a.matriculation.entries.map((e) => ({ name: e.name, count: e.count?.trim() ? parseNum(e.count) : null })) }
      : null,
  };
}

export async function runProfiles(schools: readonly RunSchool[], recipes: Record<string, ProfileRecipe>, deps: RunDeps): Promise<RunOutput> {
  const now = deps.now ?? (() => Date.now());
  const out: RunOutput = { results: [], recipes: { ...recipes }, details: [], review: [], stopped: null };
  const queue = (s: RunSchool, item: Omit<HsReviewItem, "id" | "name" | "queued" | "run">) => out.review.push({ id: s.id, name: s.name, ...item, queued: deps.today, run: deps.run });

  const one = async (s: RunSchool) => {
    if (out.stopped) {
      out.results.push({ id: s.id, status: "not-run", cost_usd: 0, ms: 0, requests: 0, error: out.stopped });
      return;
    }
    const t0 = now();
    const spentBefore = deps.cap.bySchool.get(s.id) ?? 0;
    const result: SchoolResult = { id: s.id, status: "not-found", cost_usd: 0, ms: 0, requests: 0 };
    const finish = () => {
      result.ms = Math.round(now() - t0);
      result.cost_usd = Math.round(((deps.cap.bySchool.get(s.id) ?? 0) - spentBefore) * 1e6) / 1e6;
      out.results.push(result);
    };
    deps.log(`${s.id} ${s.name} (${s.city ?? "?"}, ${s.state})`);
    try {
      const disc = await discoverProfile(s, out.recipes[s.id], {
        http: deps.http,
        log: deps.log,
        today: deps.today,
        client: deps.client,
        cap: deps.cap,
        seeds: deps.seeds?.[s.id],
        free: deps.free || deps.discoverOnly,
      });
      out.recipes[s.id] = disc.recipe;
      result.requests = disc.requests;
      if (disc.unchanged && !deps.force) {
        result.status = "unchanged";
        result.url = disc.recipe.profile?.url;
        finish();
        return;
      }
      const f = disc.found;
      if (!f) {
        if (disc.blocked.length) {
          result.status = "blocked";
          result.blocked = disc.blocked.slice(0, 3);
        }
        deps.log(disc.blocked.length ? `  profile located but robots.txt disallows it` : `  no profile found`);
        finish();
        return;
      }
      Object.assign(result, { found_via: disc.recipe.found_via, host_kind: disc.recipe.host_kind, url: f.url, format: f.doc.format, pages: f.doc.pageCount });
      deps.onFound?.(s, f);
      deps.log(`  found (${disc.recipe.found_via}, ${disc.recipe.host_kind}): ${f.url}`);
      if (deps.discoverOnly || !deps.client) {
        result.status = "not-run";
        result.error = "discovery only";
        finish();
        return;
      }

      const input = { school: s, lines: f.doc.lines, url: f.url };
      const ex = await extractProfile(deps.client, deps.cap, input);
      let answer = ex.answer;
      const ctx = { school: s, lines: f.doc.lines, url: f.url, retrieved: deps.today, hash: f.hash, index: deps.index, minEditionStart: deps.minEditionStart };
      let a = assessProfile(answer, ctx);
      const fix = escalatableFields(a);
      if (fix.length || ex.truncated) {
        try {
          const esc = await extractProfile(deps.client, deps.cap, { ...input, model: PROFILE_MODELS.escalation }, "escalation");
          answer = ex.truncated ? esc.answer : mergeAnswers(answer, esc.answer, fix);
          a = assessProfile(answer, ctx);
          result.escalated = true;
        } catch (err) {
          if (!(err instanceof SpendCapReached)) throw err;
          deps.log(`  escalation skipped: ${err.message}`);
        }
      }
      result.extracted = answerValues(answer);
      result.edition = a.edition;
      out.recipes[s.id].profile!.edition = a.edition;
      out.recipes[s.id].profile!.extracted = deps.today;
      result.passed = a.passed;
      result.withheld = a.withheld;
      result.match = a.match;
      for (const fl of a.failures) queue(s, { url: f.url, edition: a.edition, field: fl.field, check: fl.check, detail: fl.detail });
      for (const c of a.colleges) queue(s, { url: f.url, edition: a.edition, field: "matriculation", check: c.check, detail: `${c.names.length} college name(s)`, names: c.names });
      if (a.detail) {
        const problems = validateHighSchoolDetail(a.detail, { schoolIds: deps.schoolIds, collegeIds: deps.collegeIds });
        if (problems.length) {
          result.status = "failed-checks";
          for (const p of problems) queue(s, { url: f.url, edition: a.edition, field: "document", check: "empty", detail: `validator: ${p}` });
        } else {
          out.details.push(a.detail);
          result.status = "published";
        }
      } else result.status = "failed-checks";
      deps.log(`  ${result.status}: passed ${a.passed.join(", ") || "none"}${a.withheld.length ? `; withheld ${a.withheld.join(", ")}` : ""}`);
    } catch (err) {
      if (err instanceof SpendCapReached) {
        out.stopped = err.message;
        result.status = "not-run";
        result.error = err.message;
        deps.log(`  ${err.message}`);
      } else {
        result.status = "error";
        result.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
        deps.log(`  error: ${result.error}`);
      }
    }
    finish();
  };
  // Workers share the cap and the polite client (which paces each host on its own); results keep the input order.
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(deps.concurrency ?? 1, schools.length)) }, async () => {
    while (next < schools.length) await one(schools[next++]);
  });
  await Promise.all(workers);
  const order = new Map(schools.map((s, i) => [s.id, i]));
  out.results.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  out.details.sort((a, b) => (a.id < b.id ? -1 : 1));
  return out;
}

/* ------------------------------------------------------------------ */
/* Measurements                                                         */
/* ------------------------------------------------------------------ */

export interface Measurements {
  schools: number;
  attempted: number;
  found: number;
  findability: number;
  /** Located but robots.txt disallows fetching it. */
  blocked: number;
  /** Found or blocked: a profile exists online and was located. */
  located: number;
  found_by: Partial<Record<FoundVia, number>>;
  host_kinds: Partial<Record<HostKind, number>>;
  by_kind: Record<"public" | "private", { schools: number; found: number; published: number }>;
  published: number;
  failed_checks: number;
  fields_published: Record<ProfileField, number>;
  matriculation: { listed: number; matched: number; ambiguous: number; unmatched: number; match_rate: number | null };
  cost_usd: number;
  cost_per_school: number | null;
  cost_per_found: number | null;
  ms_per_school: number | null;
  requests: number;
}

export function measure(schools: readonly Pick<RunSchool, "id" | "kind">[], results: readonly SchoolResult[]): Measurements {
  const kindOf = new Map(schools.map((s) => [s.id, s.kind]));
  const attempted = results.filter((r) => r.status !== "not-run" || r.found_via);
  const found = results.filter((r) => r.url && r.status !== "not-found");
  const by_kind = { public: { schools: 0, found: 0, published: 0 }, private: { schools: 0, found: 0, published: 0 } };
  for (const s of schools) by_kind[s.kind].schools++;
  const fields_published = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, 0])) as Record<ProfileField, number>;
  const m = { listed: 0, matched: 0, ambiguous: 0, unmatched: 0 };
  const found_by: Measurements["found_by"] = {};
  const host_kinds: Measurements["host_kinds"] = {};
  for (const r of results) {
    const k = kindOf.get(r.id);
    if (r.url && r.status !== "not-found" && k) by_kind[k].found++;
    if (r.status === "published" && k) by_kind[k].published++;
    if (r.found_via && r.url) found_by[r.found_via] = (found_by[r.found_via] ?? 0) + 1;
    if (r.host_kind && r.url) host_kinds[r.host_kind] = (host_kinds[r.host_kind] ?? 0) + 1;
    if (r.status === "published") for (const f of r.passed ?? []) fields_published[f]++;
    if (r.status === "published" && r.match && r.passed?.includes("matriculation")) {
      m.listed += r.match.listed;
      m.matched += r.match.matched;
      m.ambiguous += r.match.ambiguous;
      m.unmatched += r.match.unmatched;
    }
  }
  const cost = results.reduce((a, r) => a + r.cost_usd, 0);
  const ran = results.filter((r) => r.status !== "not-run" || r.url);
  const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    schools: schools.length,
    attempted: attempted.length,
    found: found.length,
    findability: schools.length ? round(found.length / schools.length, 3) : 0,
    blocked: results.filter((r) => r.status === "blocked").length,
    located: found.length + results.filter((r) => r.status === "blocked").length,
    found_by,
    host_kinds,
    by_kind,
    published: results.filter((r) => r.status === "published").length,
    failed_checks: results.filter((r) => r.status === "failed-checks").length,
    fields_published,
    matriculation: { ...m, match_rate: m.listed ? round(m.matched / m.listed, 3) : null },
    cost_usd: round(cost, 6),
    cost_per_school: ran.length ? round(cost / ran.length) : null,
    cost_per_found: found.length ? round(cost / found.length) : null,
    ms_per_school: ran.length ? Math.round(ran.reduce((a, r) => a + r.ms, 0) / ran.length) : null,
    requests: results.reduce((a, r) => a + r.requests, 0),
  };
}
