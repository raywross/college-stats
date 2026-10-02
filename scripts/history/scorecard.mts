/**
 * College Scorecard year-prefixed fields for history (specs/trends-data.md): undergrads and race/ethnicity by fall,
 * completion by entering class, median debt by year. One query per field chunk and page (100 colleges a page, the
 * API's limit), cached in .cache/scorecard/ for a week. Needs COLLEGE_SCORECARD_API_KEY.
 *
 * Year keys, checked 2026-09-28 against the snapshot and the Urban Institute's IPEDS copy:
 *   {Y}.student.size, {Y}.student.demographics.race_ethnicity.*  → fall Y (key 2024 = the snapshot's fall 2024)
 *   {Y}.student.demographics.men, {Y}.student.part_time_share      → fall Y (checked 2026-09-29, same as size)
 *   {Y}.completion.completion_rate_4yr_150nt                      → students who entered fall Y − 6
 *   {Y}.aid.median_debt.completers.overall                         → Y–Y+1 graduates (null after 2020)
 *   {Y}.aid.federal_loan_rate                                      → the Y−1–Y school year (matches IPEDS SFA UFLOANP)
 *   {Y}.school.instructional_expenditure_per_fte                   → fiscal (Y−1)–Y, same as IPEDS DRVF{Y} (checked 2026-10-02)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCORECARD_RACE_FIELDS } from "../../lib/derive.ts";
import { FINANCE_FROM, LOAN_RATE_FROM, RACE_FROM } from "../../lib/history.ts";

const API = "https://api.data.gov/ed/collegescorecard/v1/schools";
const RACE = "student.demographics.race_ethnicity";
/** Graduation rates reported in year Y describe the class that entered in fall Y − COHORT_LAG. */
export const COHORT_LAG = 6;

export type ScorecardRow = Record<string, number | null>;

/** Every year-prefixed field history reads, from `first` to `last`. */
export function scorecardFields(first: number, last: number): string[] {
  const out: string[] = [];
  for (let y = first; y <= last; y++) {
    out.push(`${y}.student.size`, `${y}.completion.completion_rate_4yr_150nt`, `${y}.aid.median_debt.completers.overall`);
    out.push(`${y}.student.demographics.men`, `${y}.student.part_time_share`);
    if (y >= LOAN_RATE_FROM) out.push(`${y}.aid.federal_loan_rate`);
    if (y >= RACE_FROM) out.push(...SCORECARD_RACE_FIELDS.map((f) => `${y}.${RACE}.${f}`));
    if (y >= FINANCE_FROM) out.push(`${y}.school.instructional_expenditure_per_fte`);
  }
  return out;
}

async function getJson(url: string, attempt = 1): Promise<unknown> {
  try {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) throw new Error(`HTTP ${res.status}`);
    throw Object.assign(new Error(`HTTP ${res.status} for ${url.replace(/api_key=[^&]+/, "api_key=***")}`), { fatal: true });
  } catch (err) {
    if ((err as { fatal?: boolean }).fatal || attempt >= 6) throw err;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return getJson(url, attempt + 1);
  }
}

export interface ScorecardOptions {
  key: string | undefined;
  cacheDir: string;
  keep: ReadonlySet<string>;
  first: number;
  last: number;
  refresh?: boolean;
  offline?: boolean;
}

/** Year-prefixed values for every college in `keep`, keyed by unit ID. */
export async function fetchScorecardHistory(opts: ScorecardOptions): Promise<Map<string, ScorecardRow>> {
  const fields = scorecardFields(opts.first, opts.last);
  const hash = createHash("sha256").update(fields.join(",")).digest("hex").slice(0, 12);
  mkdirSync(opts.cacheDir, { recursive: true });
  const cache = join(opts.cacheDir, `history-${hash}.json`);
  const fresh = existsSync(cache) && (opts.offline || (!opts.refresh && Date.now() - statSync(cache).mtimeMs < 7 * 86_400_000));
  let rows: Record<string, ScorecardRow>;
  if (fresh) {
    rows = JSON.parse(readFileSync(cache, "utf8"));
  } else {
    if (opts.offline) throw new Error("--offline: no cached Scorecard history; run once online first.");
    if (!opts.key) throw new Error("Missing COLLEGE_SCORECARD_API_KEY (add it to .env.local; see specs/data-sync.md).");
    rows = {};
    // ~80 fields per request keeps the URL well under the API's limit.
    const chunks: string[][] = [];
    for (let i = 0; i < fields.length; i += 80) chunks.push(fields.slice(i, i + 80));
    let done = 0;
    for (const chunk of chunks) {
      let page = 0;
      let total = Infinity;
      while (page * 100 < total) {
        const params = new URLSearchParams({
          "school.degrees_awarded.predominant": "3",
          "school.operating": "1",
          per_page: "100",
          page: String(page),
          fields: ["id", ...chunk].join(","),
          api_key: opts.key,
        });
        const data = (await getJson(`${API}?${params}`)) as { metadata: { total: number }; results: Record<string, unknown>[] };
        total = data.metadata.total;
        for (const r of data.results) {
          const id = String(r.id);
          if (!opts.keep.has(id)) continue;
          const row = (rows[id] ??= {});
          for (const f of chunk) {
            const v = r[f];
            if (typeof v === "number" && Number.isFinite(v)) row[f] = v;
          }
        }
        page++;
        process.stdout.write(`\r  Scorecard: ${++done} requests`);
      }
    }
    process.stdout.write("\n");
    writeFileSync(cache, JSON.stringify(rows));
  }
  return new Map(Object.entries(rows));
}
