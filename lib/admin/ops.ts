import "server-only";
/**
 * Operations, wired to the real world (specs/product/admin.md "Operations: reruns and approvals"): the dependencies
 * the actions in lib/admin/ops-actions.ts run on (GitHub through lib/github-app.ts, the log through the
 * `admin_note_ops` function with the admin's own session), and what the page reads. Server only.
 *
 * Nothing here throws into a page: GitHub reads return empty lists on failure (lib/github-app.ts), and the log
 * lookups for "started by" fall back to "Console".
 */
import * as gh from "@/lib/github-app";
import { adminSupabase } from "@/lib/admin/people";
import { DISPATCHABLE_RUNS } from "@/lib/admin/workflows";
import { publicName, type OpsDeps } from "@/lib/admin/ops-actions";
import { runFailed } from "@/lib/admin/ops-view";

/** How many failed runs get their failed step looked up per page view (one GitHub call each). */
const FAILED_STEP_LOOKUPS = 6;

/** The acting admin's display name for public text (their profile's name; never their email). */
async function displayNameOf(userId: string): Promise<string> {
  const supabase = await adminSupabase();
  const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return publicName((data as { display_name: string | null } | null)?.display_name);
}

/** The real dependencies for one admin's action. */
export function realOpsDeps(admin: { userId: string }): OpsDeps {
  return {
    gh: {
      configured: () => gh.githubConfigured() !== null,
      dispatchWorkflow: (file, inputs, requestId, opts) => gh.dispatchWorkflow(file, inputs, requestId, { ref: opts.ref }),
      listRuns: (workflows) => gh.listRuns({ workflows, perPage: 10 }),
      findRunByRequestId: (requestId) => gh.findRunByRequestId(requestId),
      mergePull: (n) => gh.mergePull(n),
      holdPull: (n, name) => gh.holdPull(n, name),
      closePull: (n, name) => gh.closePull(n, name),
    },
    async note(action, details, requestId) {
      try {
        const supabase = await adminSupabase();
        const { error } = await supabase.rpc("admin_note_ops", { p_action: action, p_details: details, p_request_id: requestId });
        return error ? { ok: false, message: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "the log is unavailable" };
      }
    },
    adminName: () => displayNameOf(admin.userId).catch(() => "an admin"),
    now: () => new Date(),
    requestId: () => gh.newRequestId(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export type RunRow = {
  run: gh.WorkflowRun;
  /** The admin's display name when the console started the run, from the log by request id. */
  consoleAdmin: string | null;
  /** The failed job and step of a failed run. */
  failedStep: string | null;
};

export interface OperationsData {
  configured: { mode: "app" | "pat" } | null;
  runs: RunRow[];
  pulls: gh.DataPull[];
  cost: Awaited<ReturnType<typeof gh.fetchRunCost>>;
}

/** The admins who started console runs: request id to display name, from `admin_log` through the admin policy. */
async function consoleAdmins(requestIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!requestIds.length) return out;
  try {
    const supabase = await adminSupabase();
    const { data } = await supabase.from("admin_log").select("admin_id, request_id").eq("action", "ops.dispatch").in("request_id", requestIds);
    const log = (data ?? []) as { admin_id: string | null; request_id: string | null }[];
    const ids = [...new Set(log.map((r) => r.admin_id).filter((id): id is string => Boolean(id)))];
    if (!ids.length) return out;
    const { data: names } = await supabase.from("profiles").select("id, display_name").in("id", ids);
    const byId = new Map(((names ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, publicName(p.display_name)]));
    for (const r of log) if (r.request_id && r.admin_id) out.set(r.request_id, byId.get(r.admin_id) ?? "an admin");
  } catch {
    // The runs list still renders; those runs read "Console".
  }
  return out;
}

/** Everything the Operations page shows, read in parallel. With no GitHub credentials, `configured` is null and the rest is empty. */
export async function loadOperations(): Promise<OperationsData> {
  const configured = gh.githubConfigured();
  if (!configured) return { configured: null, runs: [], pulls: [], cost: null };
  const workflows = [...new Set(DISPATCHABLE_RUNS.map((r) => r.workflow))];
  const [runs, pulls, cost] = await Promise.all([gh.listRuns({ workflows, perPage: 30 }), gh.listDataPulls(), gh.fetchRunCost()]);
  const failed = runs.filter(runFailed).slice(0, FAILED_STEP_LOOKUPS);
  const [admins, steps] = await Promise.all([
    consoleAdmins(runs.map((r) => r.requestId).filter((id): id is string => Boolean(id))),
    Promise.all(failed.map((r) => gh.failedStep(r.id))),
  ]);
  const stepOf = new Map(failed.map((r, i) => [r.id, steps[i]]));
  return {
    configured,
    runs: runs.map((run) => ({
      run,
      consoleAdmin: run.requestId ? (admins.get(run.requestId) ?? null) : null,
      failedStep: stepOf.get(run.id) ?? null,
    })),
    pulls,
    cost,
  };
}
