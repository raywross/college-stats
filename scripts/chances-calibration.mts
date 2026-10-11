/**
 * The season measurements (specs/chances/method/outcomes.md "Measuring the groups"; specs/chances/calibration.md):
 * reads the consented application snapshots with their outcomes (chances_outcome_rows(), no ids) with the secret
 * key, prints the internal season report (order, the Likely-miss flag, AUC, held-out Brier, each input switched off,
 * the rigor evidence, student overrides), and replaces that season's rows in `chances_summary`, the public table the
 * Data page reads ("How well Quad's estimate did"). Run after each season and on demand.
 *
 *   npm run chances-calibration                       # the latest finished season, written
 *   npm run chances-calibration -- --dry-run          # print the rows instead of writing them
 *   npm run chances-calibration -- --season 2027      # a given (finished) season
 *   npm run chances-calibration -- --next 2028-09-15  # the "next summary" date shown on the page
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (.env.local). Exits cleanly with "no outcomes yet" when there's nothing
 * to measure, and with a note when the migrations aren't applied yet.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseClient } from "../lib/supabase.ts";
import { planCalibration, type OutcomeRow } from "../lib/chances/calibration.ts";
import { lastFinishedSeason } from "../lib/chances/snapshot.ts";

const PAGE = 1000;

function parseArgs(argv: string[]): { dryRun: boolean; season: number | null; next: string | null } {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const season = value("--season");
  const next = value("--next");
  if (season !== null && !/^\d{4}$/.test(season)) throw new Error(`--season takes a year, got "${season}"`);
  if (next !== null && !/^\d{4}-\d{2}-\d{2}$/.test(next)) throw new Error(`--next takes a date (YYYY-MM-DD), got "${next}"`);
  return { dryRun: argv.includes("--dry-run"), season: season ? Number(season) : null, next };
}

const missing = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "42883" || e.code === "PGRST202" || e.code === "PGRST205" || /does not exist|schema cache|could not find the function/i.test(e.message ?? "");

async function outcomeRows(client: SupabaseClient, upTo: number): Promise<OutcomeRow[] | "missing"> {
  const out: OutcomeRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.rpc("chances_outcome_rows", { p_from_season: 2020, p_to_season: upTo }).range(from, from + PAGE - 1);
    if (error) {
      if (missing(error)) return "missing";
      throw new Error(`chances_outcome_rows: ${error.message}`);
    }
    const page = (data ?? []) as OutcomeRow[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const finished = lastFinishedSeason(today);
  const season = args.season ?? finished;
  if (season > finished) throw new Error(`Season ${season} isn't finished yet (the latest finished season is ${finished}).`);

  const client = supabaseClient("publish");
  const rows = await outcomeRows(client, season);
  if (rows === "missing") {
    console.log("chances-calibration: the snapshot migration isn't applied yet (supabase/migrations/20261011100000_application_snapshots.sql); nothing to measure.");
    return;
  }
  const plan = planCalibration(rows, season, args.next ?? `${season + 1}-09-15`);
  if (plan.status === "empty") {
    console.log(`chances-calibration: no outcomes yet for the ${season} season; nothing written.`);
    return;
  }

  console.log(`chances-calibration: season ${season}, ${plan.report.outcomes} shared outcomes`);
  console.log(JSON.stringify(plan.report, null, 2));
  if (args.dryRun) {
    console.log(`Dry run: ${plan.summary.length} chances_summary rows (not written):`);
    console.log(JSON.stringify(plan.summary, null, 2));
    return;
  }

  const del = await client.from("chances_summary").delete().eq("season", season);
  if (del.error) {
    if (missing(del.error)) {
      console.log("chances-calibration: chances_summary isn't there yet (supabase/migrations/20261011110000_chances_summary.sql); nothing written.");
      return;
    }
    throw new Error(`chances_summary: clearing season ${season} failed: ${del.error.message}`);
  }
  const ins = await client.from("chances_summary").insert(plan.summary);
  if (ins.error) throw new Error(`chances_summary: writing failed: ${ins.error.message}`);
  console.log(`Wrote ${plan.summary.length} chances_summary rows for ${season}.`);
}

main().catch((err) => {
  console.error(`chances-calibration: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
