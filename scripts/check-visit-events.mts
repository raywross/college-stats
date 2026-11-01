/**
 * Checks the stored visit events after a sync (specs/product/visit-events.md, "Checks"; scripts/lib/visit-events/
 * check.mts): per host, the event count by kind, the staff share, the ZIP share, duplicates, starts more than 18 months
 * out, and starts long before first seen. Exits 1 when a host's logistics share (staff rows that are a college's own
 * housekeeping) is above 40%, naming the titles; a host that is mostly graduate or other non-admissions events, or
 * whose placed rows lack coordinates, is a warning.
 *
 *   npm run check:visit-events
 *   npm run check:visit-events -- --record   # also writes check_failures, check_warnings, check_summary onto the
 *                                            # newest visit_event_sync row (the run it follows; "Keeping it running")
 *
 * Reads with the secret key (SUPABASE_URL, SUPABASE_SECRET_KEY); without them it says so and exits 0.
 */
import { supabaseClient } from "../lib/supabase.ts";
import { checkHosts, checkRecord, hostReport } from "./lib/visit-events/check.mts";
import { readAllEvents, recordCheck } from "./lib/visit-events/store.mts";

const RECORD = process.argv.includes("--record");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.log("SUPABASE_URL or SUPABASE_SECRET_KEY is not set; nothing checked.");
  process.exit(0);
}

const client = supabaseClient("publish");
const now = new Date();
const rows = await readAllEvents(client);
const checks = checkHosts(rows, now);
for (const c of checks) for (const line of hostReport(c)) console.log(line);
const failing = checks.filter((c) => c.failures.length);
const total = checks.reduce((n, c) => n + c.events, 0);
const warned = checks.filter((c) => c.warnings.length);
if (checks.length) console.log(`${checks.length} hosts, ${total} live upcoming events; ${failing.length} failing, ${warned.length} with warnings.`);
else console.log("No live upcoming visit events stored.");
if (RECORD) {
  const id = await recordCheck(client, checkRecord(checks, now));
  console.log(id == null ? "No visit_event_sync row yet; the check was not recorded." : `Recorded the check on visit_event_sync ${id}.`);
}
if (failing.length) process.exit(1);
