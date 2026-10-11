/**
 * College Board's AP Course Ledger (https://apcourseaudit.inflexion.org/ledger/): the courses each school is
 * authorized to label "AP" in a school year, public and private, by name. The Ledger page is a Vue app over two JSON
 * endpoints (read from its page source; College Board publishes no download): a search that returns a whole state's
 * schools in one call, and a per-school list of AP subjects by audit year. Both need the page's CSRF token and
 * session cookie. `npm run sync-ap-ledger` writes data/high-schools/ledger/{XX}.json from them; the adapter in
 * ./ledger.mts matches those files to the shards. specs/product/high-school-data.md "AP Course Ledger".
 *
 * The site's robots.txt allows /ledger/ and disallows the rest, which includes the endpoints the page itself calls;
 * the sync keeps under the site's limit of 124 requests a minute (its X-RateLimit-Limit header; 429 above it) with
 * an identifying User-Agent, keeps every answer so a rerun fetches only new schools, and is meant to run once a year
 * after the fall republish.
 *
 * Counting rule (specs/chances/rigor-in-context.md "Pilot"): a subject counts once in a year it has an authorization
 * (`authorized_count` counts teachers); AP Seminar and AP Research count; Pre-AP is listed separately and left out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { USER_AGENT } from "./context.mts";

export const LEDGER_BASE = "https://apcourseaudit.inflexion.org";
export const LEDGER_URL = `${LEDGER_BASE}/ledger/`;
const SEARCH_PATH = "/api/ledger/search";
const SCHOOL_PATH = "/api/ledger/school";

export interface LedgerYear {
  audit_year_id: number;
  /** "2025 - 2026" */
  audit_year: string;
}

export interface LedgerSubject {
  subject_id: number;
  subject_fullname: string;
  /** 1 = AP, 2 = Pre-AP. */
  type: number;
}

export interface LedgerSession {
  token: string;
  cookie: string;
  years: LedgerYear[];
  subjects: Map<number, LedgerSubject>;
  fetchImpl: typeof fetch;
  /** Base of the retry backoff (1 s, 2 s, 4 s, 8 s); tests shorten it. */
  retryBaseMs?: number;
}

export interface LedgerSearchRow {
  id: number;
  /** The six-digit AI code (College Board's school code), the Ledger's stable school id; null for a few schools, which the Ledger addresses by org_id instead. */
  ai: string | null;
  org_id: number;
  fullname: string;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country_code: string;
  brick_mortar: number;
  /** 1 for an online provider (not a school). */
  olp: number;
}

export interface LedgerSchoolResponse {
  school: { id: number; fullname: string; address_1: string | null; city: string | null; state: string | null; zip: string | null };
  /** Keyed by subject id; an empty list when the school has no AP authorization on record. */
  ap: Record<string, { subject_id: number; years: { audit_year_id: number; authorized_count: number }[] }> | unknown[];
  preap: unknown;
}

/** One school in data/high-schools/ledger/{XX}.json. */
export interface LedgerSchoolRecord {
  /** The school's AI code, or "org-<org_id>" for the few schools the Ledger lists without one (ledgerKey). */
  ai: string;
  name: string;
  address: string | null;
  city: string | null;
  /** Five digits. */
  zip: string | null;
  /** AP courses authorized in the file's year, as catalog keys (data/reference/ap-courses.json), sorted. */
  courses: string[];
  /** Authorized AP subjects with no catalog key (a new course before the catalog has it), "AP …" as the Ledger names it. */
  other: string[];
}

export interface LedgerStateFile {
  state: string;
  /** "2025–26" */
  year: string;
  year_id: number;
  /** YYYY-MM-DD of the latest fetch. */
  retrieved: string;
  /** Every school in the Ledger's directory for the state has a record. */
  complete: boolean;
  schools: LedgerSchoolRecord[];
}

/** Ledger subject name → catalog key; null for a retired course that only appears in old years. */
export const LEDGER_SUBJECT_KEYS: Readonly<Record<string, string | null>> = {
  "2-D Art and Design": "ap_2d_art_and_design",
  "3-D Art and Design": "ap_3d_art_and_design",
  "African American Studies": "ap_african_american_studies",
  "Art History": "ap_art_history",
  Biology: "ap_biology",
  "Business with Personal Finance": "ap_business_personal_finance",
  "Calculus AB": "ap_calculus_ab",
  "Calculus BC": "ap_calculus_bc",
  Chemistry: "ap_chemistry",
  "Chinese Language and Culture": "ap_chinese",
  "Comparative Government and Politics": "ap_comparative_government",
  "Computer Science A": "ap_computer_science_a",
  "Computer Science AB": null,
  "Computer Science Principles": "ap_computer_science_principles",
  Cybersecurity: "ap_cybersecurity",
  Drawing: "ap_drawing",
  "English Language and Composition": "ap_english_language",
  "English Literature and Composition": "ap_english_literature",
  "Environmental Science": "ap_environmental_science",
  "European History": "ap_european_history",
  "French Language and Culture": "ap_french",
  "French Literature": null,
  "German Language and Culture": "ap_german",
  "Human Geography": "ap_human_geography",
  "Italian Language and Culture": "ap_italian",
  "Japanese Language and Culture": "ap_japanese",
  Latin: "ap_latin",
  "Latin Literature": null,
  Macroeconomics: "ap_macroeconomics",
  Microeconomics: "ap_microeconomics",
  "Music Theory": "ap_music_theory",
  "Physics 1": "ap_physics_1",
  "Physics 2": "ap_physics_2",
  "Physics B": null,
  "Physics C: Electricity and Magnetism": "ap_physics_c_electricity_and_magnetism",
  "Physics C: Mechanics": "ap_physics_c_mechanics",
  Precalculus: "ap_precalculus",
  Psychology: "ap_psychology",
  Research: "ap_research",
  Seminar: "ap_seminar",
  "Spanish Language and Culture": "ap_spanish_language",
  "Spanish Literature and Culture": "ap_spanish_literature",
  Statistics: "ap_statistics",
  "U.S. Government and Politics": "ap_us_government",
  "United States History": "ap_us_history",
  "World History: Modern": "ap_world_history_modern",
};

/** "2025 - 2026" → "2025–26". */
export function ledgerYearLabel(y: Pick<LedgerYear, "audit_year">): string {
  const m = /^(\d{4})\s*-\s*(\d{4})$/.exec(y.audit_year.trim());
  return m ? `${m[1]}–${m[2].slice(2)}` : y.audit_year.trim();
}

/** The newest year the Ledger publishes (the current one until the next fall's republish). */
export function currentLedgerYear(years: readonly LedgerYear[]): LedgerYear {
  if (!years.length) throw new Error("AP Course Ledger: no audit years on the page");
  return years.reduce((a, b) => (b.audit_year_id > a.audit_year_id ? b : a));
}

/** Parse the inline constants the Ledger page carries (years, subjects) and its CSRF token. */
export function parseLedgerPage(html: string): { token: string; years: LedgerYear[]; subjects: LedgerSubject[] } {
  const token = /name="csrf-token"\s+content="([^"]+)"/.exec(html)?.[1];
  const years = /const AUDIT_YEARS = (\[.*?\]);/.exec(html)?.[1];
  const subjects = /const AUDIT_SUBJECTS = (\[.*?\]);/.exec(html)?.[1];
  if (!token || !years || !subjects) throw new Error("AP Course Ledger: the page no longer carries its csrf-token, AUDIT_YEARS, or AUDIT_SUBJECTS; the sync needs updating");
  return { token, years: JSON.parse(years) as LedgerYear[], subjects: JSON.parse(subjects) as LedgerSubject[] };
}

export async function openLedgerSession(fetchImpl: typeof fetch = fetch): Promise<LedgerSession> {
  const res = await fetchImpl(LEDGER_URL, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
  if (!res.ok) throw new Error(`${LEDGER_URL}: HTTP ${res.status}`);
  const html = await res.text();
  const { token, years, subjects } = parseLedgerPage(html);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { token, cookie, years, subjects: new Map(subjects.map((s) => [s.subject_id, s])), fetchImpl };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(session: LedgerSession, path: string, body: unknown, attempts = 4): Promise<T> {
  let lastError: unknown;
  let throttled = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await session.fetchImpl(LEDGER_BASE + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-TOKEN": session.token,
          Cookie: session.cookie,
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(body),
      });
      if (res.status === 419 || res.status === 401) {
        // The session expired: open a fresh one and retry.
        const fresh = await openLedgerSession(session.fetchImpl);
        session.token = fresh.token;
        session.cookie = fresh.cookie;
        throw new Error(`HTTP ${res.status} (session renewed)`);
      }
      if (res.status === 429 && throttled++ < 6) {
        // Rate limited: wait out the window (Retry-After when given, else a minute) without spending an attempt.
        const after = Number(res.headers.get("retry-after"));
        await sleep(Math.max(Number.isFinite(after) && after > 0 ? after * 1000 : 0, session.retryBaseMs === undefined ? 60_000 : session.retryBaseMs * 60));
        i--;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      await sleep((session.retryBaseMs ?? 1000) * 2 ** i);
    }
  }
  throw new Error(`${path} ${JSON.stringify(body)}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** Every school the Ledger lists for a state (one call), or a city's / a name's. Online providers come back too (olp = 1). */
export async function ledgerSearch(session: LedgerSession, params: { state: string; city?: string; name?: string }): Promise<LedgerSearchRow[]> {
  const body: Record<string, string> = { institution: "S", country: "US", state: params.state };
  if (params.city) body.city = params.city;
  if (params.name) body.name = params.name;
  const r = await post<{ results?: LedgerSearchRow[] }>(session, SEARCH_PATH, body);
  return r.results ?? [];
}

/** The Ledger's id for a directory row: its AI code, else "org-<org_id>" (the page's /ledger/school/org/<id> route). */
export function ledgerKey(row: Pick<LedgerSearchRow, "ai" | "org_id">): string {
  return row.ai && /^\d+$/.test(row.ai) ? row.ai : `org-${row.org_id}`;
}

export async function ledgerSchool(session: LedgerSession, key: string): Promise<LedgerSchoolResponse> {
  const org = /^org-(\d+)$/.exec(key);
  return post<LedgerSchoolResponse>(session, SCHOOL_PATH, org ? { type: "org", identifier: org[1] } : { type: "ai", identifier: key });
}

/** The AP subjects a school is authorized for in one audit year, as catalog keys plus the names the catalog lacks. */
export function coursesInYear(
  resp: Pick<LedgerSchoolResponse, "ap">,
  yearId: number,
  subjects: ReadonlyMap<number, LedgerSubject>,
): { courses: string[]; other: string[] } {
  const courses = new Set<string>();
  const other = new Set<string>();
  const ap = Array.isArray(resp.ap) ? [] : Object.values(resp.ap ?? {});
  for (const entry of ap) {
    if (!entry.years?.some((y) => y.audit_year_id === yearId && y.authorized_count > 0)) continue;
    const subject = subjects.get(entry.subject_id);
    if (!subject || subject.type !== 1) continue;
    const name = subject.subject_fullname.trim();
    if (!(name in LEDGER_SUBJECT_KEYS)) {
      other.add(`AP ${name}`);
      continue;
    }
    const key = LEDGER_SUBJECT_KEYS[name];
    if (key) courses.add(key);
  }
  return { courses: [...courses].sort(), other: [...other].sort() };
}

export function ledgerDir(outDir: string): string {
  return join(outDir, "ledger");
}

export function readLedgerStateFile(outDir: string, state: string): LedgerStateFile | null {
  const path = join(ledgerDir(outDir), `${state.toUpperCase()}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as LedgerStateFile;
}

/** One school per line, sorted by AI code, so diffs read school by school. */
export function formatLedgerStateFile(file: LedgerStateFile): string {
  const schools = [...file.schools].sort((a, b) => (a.ai < b.ai ? -1 : a.ai > b.ai ? 1 : 0));
  const head = JSON.stringify({ state: file.state, year: file.year, year_id: file.year_id, retrieved: file.retrieved, complete: file.complete }, null, 2).slice(0, -2);
  return `${head},\n  "schools": [\n${schools.map((s) => `    ${JSON.stringify(s)}`).join(",\n")}\n  ]\n}\n`;
}

export function writeLedgerStateFile(outDir: string, file: LedgerStateFile): string {
  mkdirSync(ledgerDir(outDir), { recursive: true });
  const path = join(ledgerDir(outDir), `${file.state}.json`);
  writeFileSync(path, formatLedgerStateFile(file));
  return path;
}

const zip5 = (zip: string | null | undefined): string | null => {
  const m = /^\s*(\d{5})/.exec(zip ?? "");
  return m ? m[1] : null;
};

export function toLedgerRecord(row: LedgerSearchRow, courses: { courses: string[]; other: string[] }): LedgerSchoolRecord {
  return {
    ai: ledgerKey(row),
    name: row.fullname.trim().replace(/\s+/g, " "),
    address: [row.address_1, row.address_2].filter((a): a is string => !!a && !!a.trim()).join(", ") || null,
    city: row.city?.trim() || null,
    zip: zip5(row.zip),
    courses: courses.courses,
    other: courses.other,
  };
}

export interface FetchLedgerStateOptions {
  state: string;
  outDir: string;
  session: LedgerSession;
  /** YYYY-MM-DD. */
  today: string;
  log?: (message: string) => void;
  /** Stop after this many new school fetches (a trial run). */
  limit?: number;
  /** Parallel requests; default 2. */
  concurrency?: number;
  /** Pause after each request per worker, in ms; default 800 (the site allows 124 requests a minute, X-RateLimit-Limit, and answers 429 above it). */
  delayMs?: number;
  /** Refetch schools already in the file. Default: keep them (a rerun fetches only new schools). */
  refresh?: boolean;
}

/**
 * Fetch (or continue fetching) one state's Ledger file: the directory in one search, then each school's course list
 * for the current year. Schools already in the file for the same year are kept unless `refresh`; the file is written
 * every 100 schools and at the end, so an interrupted run resumes where it stopped.
 */
export async function fetchLedgerState(opts: FetchLedgerStateOptions): Promise<{ file: LedgerStateFile; fetched: number; kept: number; failed: number }> {
  const state = opts.state.toUpperCase();
  const log = opts.log ?? (() => {});
  const year = currentLedgerYear(opts.session.years);
  const label = ledgerYearLabel(year);
  const existing = readLedgerStateFile(opts.outDir, state);
  const kept = new Map<string, LedgerSchoolRecord>();
  if (existing && existing.year_id === year.audit_year_id && !opts.refresh) for (const s of existing.schools) kept.set(s.ai, s);

  const seen = new Set<string>();
  const directory = (await ledgerSearch(opts.session, { state }))
    .filter((r) => r.olp !== 1 && r.country_code === "US" && (r.state ?? state) === state)
    .filter((r) => (seen.has(ledgerKey(r)) ? false : (seen.add(ledgerKey(r)), true)));
  log(`${state}: ${directory.length} schools in the Ledger (${label}); ${[...kept.keys()].filter((ai) => seen.has(ai)).length} already fetched`);

  const records = new Map<string, LedgerSchoolRecord>();
  for (const r of directory) {
    const k = kept.get(ledgerKey(r));
    if (k) records.set(ledgerKey(r), { ...k, name: r.fullname.trim().replace(/\s+/g, " "), city: r.city?.trim() || null, zip: zip5(r.zip) });
  }
  const todo = directory.filter((r) => !records.has(ledgerKey(r)));
  const limited = opts.limit !== undefined ? todo.slice(0, opts.limit) : todo;

  const file = (): LedgerStateFile => ({
    state,
    year: label,
    year_id: year.audit_year_id,
    retrieved: opts.today,
    complete: directory.every((r) => records.has(ledgerKey(r))),
    schools: [...records.values()].sort((a, b) => (a.ai < b.ai ? -1 : a.ai > b.ai ? 1 : 0)),
  });

  let fetched = 0;
  let failed = 0;
  let next = 0;
  let sinceWrite = 0;
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const delayMs = opts.delayMs ?? 800;
  const worker = async () => {
    while (next < limited.length) {
      const row = limited[next++];
      try {
        const resp = await ledgerSchool(opts.session, ledgerKey(row));
        records.set(ledgerKey(row), toLedgerRecord(row, coursesInYear(resp, year.audit_year_id, opts.session.subjects)));
        fetched++;
      } catch (err) {
        failed++;
        log(`  ${state} ${ledgerKey(row)} ${row.fullname}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (++sinceWrite >= 100) {
        sinceWrite = 0;
        writeLedgerStateFile(opts.outDir, file());
        log(`  ${state}: ${records.size} of ${directory.length} fetched`);
      }
      await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const out = file();
  writeLedgerStateFile(opts.outDir, out);
  return { file: out, fetched, kept: directory.length - todo.length, failed };
}
