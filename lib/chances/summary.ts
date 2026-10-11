import "server-only";
/**
 * The published accuracy summary (`chances_summary`, supabase/migrations/20261011110000_chances_summary.sql), read for
 * the Data page's "How well Quad's estimate did" with the publishable key, the same read path as the high school
 * tables (lib/high-schools.ts). Fail-soft: no Supabase configured, the migration not applied, or any error reads as
 * no rows, and the page shows "not enough outcomes yet".
 */
import { cache } from "react";
import { supabaseClient } from "@/lib/supabase";
import type { SummaryRow } from "@/lib/chances/calibration";

const COLUMNS = "season, model_version, scope, estimate_group, rate_band, n, admitted, interval_low, interval_high, sharers_mix, next_summary_on";

export const getChancesSummary = cache(async (): Promise<SummaryRow[]> => {
  if (!process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_PUBLISHABLE_KEY?.trim()) return [];
  try {
    const { data, error } = await supabaseClient("read").from("chances_summary").select(COLUMNS).order("season", { ascending: false }).limit(500);
    if (error) {
      if (!/does not exist|schema cache/i.test(error.message)) console.error(`Chances summary: reading failed; rendering without it. ${error.message}`);
      return [];
    }
    return ((data ?? []) as SummaryRow[]).map((r) => ({
      ...r,
      interval_low: r.interval_low === null ? null : Number(r.interval_low),
      interval_high: r.interval_high === null ? null : Number(r.interval_high),
    }));
  } catch (err) {
    console.error("Chances summary: reading failed; rendering without it.", err);
    return [];
  }
});
