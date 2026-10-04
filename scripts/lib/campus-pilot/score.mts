/**
 * Scoring the campus-life pilot against the hand-checked answer key (one JSON file, `colleges.<unit_id>`, every fact
 * `{value, url, quote, checked}`). Pure: the CLI (scripts/score-campus-pilot.mts) reads the files.
 *
 * Rules, from the key's author (2026-10-04):
 * 1. Gender-inclusive housing, name on records, restrooms, and health plan were checked by hand only at BACKFILLED; at
 *    other colleges a key "not_found" means "not checked", so those items are scored only there.
 * 2. Key facts marked "blocked" are not ground truth: left out of precision and recall; where the pipeline was also
 *    blocked, that's counted separately.
 * 3. `search_snippet_unverified` is never truth.
 * 4. Colleges that contradict themselves (Ole Miss, Utah, Alabama Greek numbers): a value within one chapter of the
 *    key, or 2% of members, counts as correct.
 * Precision = correct published / published (where the key has an answer); recall = correct published / key facts
 * with a positive answer.
 */
import type { CollegeResult, CampusRecipe } from "./run.mts";
import type { CallRow } from "./llm.mts";
import type { Tradition } from "../../../lib/directories.ts";

export const BACKFILLED = new Set(["228778", "131496", "110662", "167835", "209922", "131520", "236948", "230764", "104151", "221999", "100751"]);
const BACKFILLED_ITEMS = new Set(["inclusive_housing", "name_on_records", "inclusive_restrooms", "health_plan_transition"]);

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface KeyFile {
  colleges: Record<string, Any>;
}

export interface Tally {
  published: number;
  correct: number;
  /** Key facts with a positive answer (a value, "yes", "no", present). */
  expected: number;
  found: number;
  /** Key says blocked; the pipeline also couldn't read (or published nothing). */
  blocked_both: number;
  wrong: string[];
}

const tally = (): Tally => ({ published: 0, correct: 0, expected: 0, found: 0, blocked_both: 0, wrong: [] });
const isBlocked = (k: Any) => k && typeof k === "object" && k.status === "blocked";
const has = (v: unknown) => v !== null && v !== undefined && v !== "not_found" && v !== "none" && v !== "n/a";

const COUNCIL_OF: Record<string, string> = { ifc: "nic", nic: "nic", npc: "npc", panhellenic: "npc", nphc: "nphc", latino: "nalfo", nalfo: "nalfo", asian: "napa", napa: "napa", mgc: "nmgc", nmgc: "nmgc", multicultural: "nmgc", lgbtq: "lgbtq" };
export const councilOf = (type: string) => COUNCIL_OF[String(type).toLowerCase()] ?? "professional";

const TRADITION_OF: Record<Tradition, string> = {
  christian: "protestant_evangelical",
  catholic: "catholic",
  orthodox: "orthodox_christian",
  latter_day_saint: "latter_day_saint",
  jewish: "jewish",
  muslim: "muslim",
  hindu: "hindu",
  sikh: "sikh",
  buddhist: "buddhist",
  nonreligious: "nonreligious_secular",
  interfaith: "other",
  bahai: "other",
  other: "other",
};

const SEASON = /(fall|autumn|spring|winter|summer|january|february|august|september|october|november|december)/i;
const season = (s: string) => {
  const m = SEASON.exec(s)?.[1]?.toLowerCase();
  if (!m) return null;
  if (["august", "september", "october", "november", "autumn"].includes(m)) return "fall";
  if (["january", "february"].includes(m)) return "spring|winter";
  return m === "spring" || m === "winter" ? "spring|winter" : m;
};
const close = (a: number, b: number, rel = 0.02) => Math.abs(a - b) <= Math.max(1, b * rel);

export interface ScoreInput {
  results: CollegeResult[];
  recipes: CampusRecipe[];
  calls: CallRow[];
  key: KeyFile;
}

export interface Score {
  facts: Record<string, Tally>;
  discovery: Record<string, { key_has: number; found_page: number; same_page: number; blocked: number }>;
  second_check: { checks: number; confirmed: number; rejected: number; agree_with_key: number; disagree_with_key: number; unscored: number; disagreements: string[] };
  cost: { total: number; colleges: number; per_college: number; by_job: Record<string, number>; by_domain: Record<string, number>; searches: number };
}

const urlKey = (u: string | null | undefined) => {
  if (!u) return "";
  try {
    const x = new URL(u);
    return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
};

export function score(input: ScoreInput): Score {
  const facts: Record<string, Tally> = {};
  const t = (k: string) => (facts[k] ??= tally());
  const second: Score["second_check"] = { checks: 0, confirmed: 0, rejected: 0, agree_with_key: 0, disagree_with_key: 0, unscored: 0, disagreements: [] };
  // Round 1's key checked four policy items only at BACKFILLED; a key that checked every item everywhere (round 2's)
  // says so in `_meta.all_policy_items_checked`, and then every college's answers count.
  const allChecked = (input.key as { _meta?: { all_policy_items_checked?: boolean } })._meta?.all_policy_items_checked === true;
  const unchecked = (item: string, unitId: string) => !allChecked && BACKFILLED_ITEMS.has(item) && !BACKFILLED.has(unitId);

  /** One yes/no-style fact: `p` the published value or null, `k` the key fact. */
  const judge = (name: string, id: string, p: string | null, k: Any, positive: (v: Any) => boolean, eq: (p: string, v: Any) => boolean) => {
    const T = t(name);
    if (isBlocked(k)) {
      if (p === null) T.blocked_both++;
      return;
    }
    const v = k?.value;
    if (positive(v)) T.expected++;
    if (p === null) return;
    T.published++;
    if (eq(p, v)) {
      T.correct++;
      if (positive(v)) T.found++;
    } else T.wrong.push(`${id}: published ${p}, key ${JSON.stringify(v)}`);
  };

  for (const r of input.results) {
    const K = input.key.colleges[r.unit_id];
    if (!K) continue;
    const id = `${r.unit_id} ${r.name}`;
    const g = r.greek;
    const kg = K.greek ?? {};

    // Greek status: "none_stated" ↔ key "none_reported"; "present" when any Greek fact published.
    const pStatus = g?.none_stated ? "none_reported" : g && (g.councils?.length || g.members_total || g.formal_term || g.deferred || g.housing) ? "present" : null;
    judge("greek.status", id, pStatus, kg.status, (v) => v === "present" || v === "none_reported", (p, v) => p === v);
    judge("greek.members_total", id, g?.members_total ? String(g.members_total.value) : null, kg.members_total, (v) => typeof v === "number", (p, v) => typeof v === "number" && close(Number(p), v));
    judge("greek.housing", id, g?.housing?.value ?? null, kg.housing, (v) => typeof v === "boolean", (p, v) => (p === "yes") === v);
    judge("greek.deferred", id, g?.deferred?.value ?? null, kg.recruitment?.deferred, (v) => typeof v === "boolean", (p, v) => (p === "yes") === v);
    judge("greek.formal_term", id, g?.formal_term?.value ?? null, kg.recruitment?.formal_term, (v) => typeof v === "string" && has(v), (p, v) => typeof v === "string" && season(p) !== null && season(p) === season(v));
    // Councils: per council type, chapters and members.
    const kc: Any[] = (kg.councils ?? []).filter((c: Any) => !isBlocked(c));
    const pc = g?.councils ?? [];
    for (const field of ["chapters", "members"] as const) {
      const T = t(`greek.council_${field}`);
      for (const c of kc) if (typeof c[field] === "number") T.expected++;
      for (const c of pc) {
        if (c[field] === null) continue;
        const match = kc.find((k) => councilOf(k.type) === c.council && typeof k[field] === "number");
        if (!match) {
          if (kc.length) {
            T.published++;
            T.wrong.push(`${id}: ${c.name} ${field} ${c[field]} (no such council in the key)`);
          }
          continue;
        }
        T.published++;
        const ok = field === "chapters" ? Math.abs(c[field]! - match[field]) <= 1 : close(c[field]!, match[field]);
        if (ok) {
          T.correct++;
          T.found++;
        } else T.wrong.push(`${id}: ${c.name} ${field} ${c[field]}, key ${match[field]}`);
      }
    }

    // Religious life.
    const kr = K.religious ?? {};
    judge("faith.office", id, r.faith?.office?.name ?? null, kr.office, (v) => typeof v === "string" && has(v), (_p, v) => typeof v === "string" && has(v));
    const comp = r.faith?.composition;
    judge("faith.composition", id, comp ? JSON.stringify(comp.items.slice(0, 3)) : null, kr.composition, (v) => Array.isArray(v), (_p, v) => {
      if (!Array.isArray(v) || !comp) return false;
      // The largest published item matches a key item by label and share (±1 point) or count (±2%).
      const top = [...comp.items].sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || (b.count ?? 0) - (a.count ?? 0))[0];
      const k = v.find((i: Any) => String(i.label).toLowerCase().includes(top.label.toLowerCase().split(/[ (]/)[0]) || top.label.toLowerCase().includes(String(i.label).toLowerCase().split(/[ (]/)[0]));
      if (!k) return false;
      return (top.share !== null && typeof k.share === "number" && Math.abs(top.share - k.share) <= 0.01) || (top.count !== null && typeof k.count === "number" && close(top.count, k.count));
    });
    // Faith communities: presence per tradition (tier B listings).
    {
      const T = t("faith.groups_by_tradition");
      const kcom = kr.communities ?? {};
      const keyTrad = new Set(Object.entries(kcom).filter(([, list]) => Array.isArray(list) && (list as Any[]).some((x) => !isBlocked(x))).map(([k]) => k));
      const pTrad = new Set(r.listings.filter((l) => l.domain === "faith" && l.kind === "group" && l.tradition).map((l) => TRADITION_OF[l.tradition!]));
      T.expected += keyTrad.size;
      for (const tr of pTrad) {
        T.published++;
        if (keyTrad.has(tr)) {
          T.correct++;
          T.found++;
        } else T.wrong.push(`${id}: ${tr} group published; key lists none`);
      }
    }
    {
      const T = t("faith.estimates");
      const est = r.listings.filter((l) => l.kind === "estimate");
      T.published += est.length;
      for (const e of est) T.wrong.push(`${id}: estimate "${e.fact}" by ${e.publisher} (key has no verified estimate; check by hand)`);
    }

    // LGBTQ+.
    const kl = K.lgbtq ?? {};
    const center = r.lgbtq?.center;
    judge("lgbtq.center", id, center ? center.status : null, kl.center, (v) => v && typeof v === "object" && (v.status === "open" || v.status === "closed"), (p, v) => v && typeof v === "object" && v.status === p);
    {
      const T = t("lgbtq.groups");
      const kg2: Any[] = (kl.groups ?? []).filter((x: Any) => !isBlocked(x));
      if (kg2.length) T.expected++;
      if (r.listings.some((l) => l.domain === "lgbtq")) {
        T.published++;
        if (kg2.length) {
          T.correct++;
          T.found++;
        } else T.wrong.push(`${id}: LGBTQ+ groups published; key lists none`);
      }
    }
    const policies = r.lgbtq?.policies ?? [];
    for (const key of ["nondiscrimination_orientation", "nondiscrimination_identity", "inclusive_housing", "name_on_records", "inclusive_restrooms", "health_plan_transition", "trans_admission"]) {
      if (unchecked(key, r.unit_id)) continue;
      const kp = kl.policies?.[key];
      if (kp?.value === "n/a") continue;
      const p = policies.find((x) => x.key === key)?.value ?? null;
      // "partial" (covered by a harassment policy, not the nondiscrimination notice): either answer is defensible.
      if (kp?.value === "partial") {
        if (p) {
          t(`policy.${key}`).published++;
          t(`policy.${key}`).correct++;
        }
        continue;
      }
      judge(`policy.${key}`, id, p, kp, (v) => v === "yes" || v === "no", (pp, v) => pp === v);
    }
    const conduct = policies.find((x) => x.key === "conduct_restriction");
    judge("lgbtq.conduct_restriction", id, conduct ? "yes" : null, kl.conduct ?? { value: null }, (v) => !!(v && typeof v === "object" && v.restricts), (_p, v) => !!(v && typeof v === "object" && v.restricts));

    // The second check against the key: a confirmed finding should match the key; a rejected one shouldn't.
    for (const c of r.checks) {
      second.checks++;
      if (c.confirmed) second.confirmed++;
      else second.rejected++;
      let truth: boolean | null = null;
      const pol = /^lgbtq\.(\w+)$/.exec(c.fact)?.[1];
      if (pol === "conduct_restriction") truth = isBlocked(kl.conduct) ? null : !!kl.conduct?.value?.restricts;
      else if (pol && kl.policies?.[pol]) {
        const v = kl.policies[pol];
        truth = isBlocked(v) || v.value === "partial" || unchecked(pol, r.unit_id) ? null : v.value === "no";
      } else if (c.fact === "faith.composition") truth = isBlocked(kr.composition) ? null : Array.isArray(kr.composition?.value);
      if (truth === null) second.unscored++;
      else if (truth === c.confirmed) second.agree_with_key++;
      else {
        second.disagree_with_key++;
        second.disagreements.push(`${id}: ${c.fact} ${c.confirmed ? "confirmed" : "rejected"}; key says ${truth ? "true" : "false"} (${c.reason})`);
      }
    }
  }

  // Discovery: per source type, did discovery find a readable page where the key has one, and was it the key's page?
  const KEY_URL: Record<string, (K: Any) => Any> = {
    fsl_office: (K) => K.greek?.office,
    fsl_reports: (K) => (K.greek?.councils?.length ? { url: K.greek.councils[0].url, value: 1 } : null),
    recruitment: (K) => K.greek?.recruitment?.formal_term ?? K.greek?.recruitment?.deferred,
    faith_office: (K) => K.religious?.office,
    religion_report: (K) => K.religious?.composition,
    lgbtq_center: (K) => K.lgbtq?.center,
    nondiscrimination: (K) => K.lgbtq?.policies?.nondiscrimination_orientation,
    housing: (K) => K.lgbtq?.policies?.inclusive_housing,
    name_policy: (K) => K.lgbtq?.policies?.name_on_records,
    restrooms: (K) => K.lgbtq?.policies?.inclusive_restrooms,
    health_plan: (K) => K.lgbtq?.policies?.health_plan_transition,
    conduct_code: (K) => K.lgbtq?.conduct,
  };
  const discovery: Score["discovery"] = {};
  for (const rec of input.recipes) {
    const K = input.key.colleges[rec.unit_id];
    if (!K || !input.results.some((r) => r.unit_id === rec.unit_id)) continue;
    for (const [type, get] of Object.entries(KEY_URL)) {
      const D = (discovery[type] ??= { key_has: 0, found_page: 0, same_page: 0, blocked: 0 });
      const k = get(K);
      const ours = rec.sources.filter((s) => s.type === type);
      if (ours.some((s) => s.status === "blocked")) D.blocked++;
      if (!k || isBlocked(k) || !k.url || !has(typeof k.value === "object" ? "obj" : k.value)) continue;
      D.key_has++;
      if (ours.some((s) => s.status === "ok")) D.found_page++;
      if (ours.some((s) => urlKey(s.url) === urlKey(k.url))) D.same_page++;
    }
  }

  const by_job: Record<string, number> = {};
  const by_domain: Record<string, number> = {};
  let total = 0;
  let searches = 0;
  for (const c of input.calls) {
    total += c.cost_usd;
    searches += c.searches;
    by_job[c.job] = (by_job[c.job] ?? 0) + c.cost_usd;
    by_domain[c.domain ?? "none"] = (by_domain[c.domain ?? "none"] ?? 0) + c.cost_usd;
  }
  const colleges = new Set(input.calls.map((c) => c.college)).size;
  return { facts, discovery, second_check: second, cost: { total, colleges, per_college: colleges ? total / colleges : 0, by_job, by_domain, searches } };
}

/** Precision and recall as fractions (null when undefined). */
export function rates(T: Tally): { precision: number | null; recall: number | null } {
  return { precision: T.published ? T.correct / T.published : null, recall: T.expected ? T.found / T.expected : null };
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

/** The report's tables, as markdown. */
export function scoreMarkdown(s: Score, o: { fullRun?: number } = {}): string {
  const lines: string[] = [];
  lines.push("| Fact type | Published | Correct | Precision | Key answers | Found | Recall | Blocked (key and us) |", "|---|---|---|---|---|---|---|---|");
  for (const [k, T] of Object.entries(s.facts).sort()) {
    const r = rates(T);
    lines.push(`| ${k} | ${T.published} | ${T.correct} | ${pct(r.precision)} | ${T.expected} | ${T.found} | ${pct(r.recall)} | ${T.blocked_both} |`);
  }
  lines.push("", "| Source type | Key has a readable page | We read a page of that type | Same page as the key | We were blocked |", "|---|---|---|---|---|");
  for (const [k, D] of Object.entries(s.discovery)) lines.push(`| ${k} | ${D.key_has} | ${D.found_page} (${pct(D.key_has ? D.found_page / D.key_has : null)}) | ${D.same_page} | ${D.blocked} |`);
  const sc = s.second_check;
  lines.push("", `Second check: ${sc.checks} findings, ${sc.confirmed} confirmed, ${sc.rejected} rejected; against the key ${sc.agree_with_key} agree, ${sc.disagree_with_key} disagree, ${sc.unscored} unscored.`);
  const n = o.fullRun ?? 1890;
  lines.push(
    "",
    `Cost: $${s.cost.total.toFixed(2)} for ${s.cost.colleges} colleges ($${s.cost.per_college.toFixed(3)} each; ${s.cost.searches} web searches). By job: ${Object.entries(s.cost.by_job)
      .map(([k, v]) => `${k} $${v.toFixed(2)}`)
      .join(", ")}. Projected for ${n.toLocaleString("en-US")} colleges at this configuration: $${(s.cost.per_college * n).toFixed(0)}.`
  );
  return lines.join("\n");
}
