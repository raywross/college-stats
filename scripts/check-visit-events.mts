/**
 * Checks the stored visit events after a sync (specs/product/visit-events.md, "Checks"; scripts/lib/visit-events/
 * check.mts): per host, the event count by kind, the staff share, the ZIP share, duplicates, starts more than 18 months
 * out, and starts long before first seen. Exits 1 when a host's staff share is above 40% or its ZIP share below 80%,
 * naming the titles.
 *
 *   npm run check:visit-events
 *
 * Reads with the secret key (SUPABASE_URL, SUPABASE_SECRET_KEY); without them it says so and exits 0.
 */
import { supabaseClient } from "../lib/supabase.ts";
import { checkHosts, hostReport } from "./lib/visit-events/check.mts";
import { readAllEvents } from "./lib/visit-events/store.mts";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.log("SUPABASE_URL or SUPABASE_SECRET_KEY is not set; nothing checked.");
  process.exit(0);
}

const rows = await readAllEvents(supabaseClient("publish"));
const checks = checkHosts(rows, new Date());
if (!checks.length) {
  console.log("No live upcoming visit events stored.");
  process.exit(0);
}
for (const c of checks) for (const line of hostReport(c)) console.log(line);
const failing = checks.filter((c) => c.failures.length);
const total = checks.reduce((n, c) => n + c.events, 0);
console.log(`${checks.length} hosts, ${total} live upcoming events; ${failing.length} failing.`);
if (failing.length) process.exit(1);
