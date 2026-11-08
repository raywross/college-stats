/**
 * Copy environment variables from .env.local to the Vercel project (specs/supabase.md "Hosting configuration").
 *
 *   npm run vercel-env -- SUPABASE_SECRET_KEY                 set it (Sensitive) for Production and Preview
 *   npm run vercel-env -- EMAIL_FROM --plain                  a readable value (shown in the dashboard)
 *   npm run vercel-env -- CRON_SECRET --target production     one environment only (comma-separated list)
 *   npm run vercel-env -- SUPABASE_SECRET_KEY --redeploy      then rebuild the current production deployment
 *   npm run vercel-env -- --redeploy                          redeploy only
 *
 * Each named variable is read from the process environment (the npm script loads .env.local), so a value never
 * appears on the command line or in a transcript. The write goes through the Vercel CLI's saved login
 * (`vercel api …/env?upsert=true`), the same way the dashboard does it, and is read back to confirm the targets.
 * A deployment only sees new values after a rebuild, which `--redeploy` does with `vercel redeploy`.
 *
 * VERCEL_PROJECT (default college-stats) and VERCEL_TEAM (default raywross-projects) name the project.
 */
import { execFileSync } from "node:child_process";

const PROJECT = process.env.VERCEL_PROJECT ?? "college-stats";
const TEAM = process.env.VERCEL_TEAM ?? "raywross-projects";
const TARGETS = new Set(["production", "preview", "development"]);

const args = process.argv.slice(2);
const names: string[] = [];
let plain = false;
let redeploy = false;
let targets = ["production", "preview"];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--plain") plain = true;
  else if (a === "--redeploy") redeploy = true;
  else if (a === "--target") {
    targets = (args[++i] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (!targets.length || targets.some((t) => !TARGETS.has(t))) throw new Error(`--target takes a comma-separated list of ${[...TARGETS].join(", ")}`);
  } else if (/^[A-Z][A-Z0-9_]*$/.test(a)) names.push(a);
  else throw new Error(`usage: npm run vercel-env -- NAME [NAME…] [--plain] [--target production,preview] [--redeploy]; "${a}" isn't a variable name`);
}
if (!names.length && !redeploy) throw new Error("Name at least one variable, or pass --redeploy.");

/** One call to the Vercel CLI; the saved login supplies the token. */
function vercel(cliArgs: string[], input?: string): string {
  return execFileSync("npx", ["--yes", "vercel@latest", ...cliArgs, "--scope", TEAM], { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
}
function api<T>(endpoint: string, body?: unknown): T {
  const out = vercel(["api", endpoint, "--raw", ...(body ? ["--input", "-"] : [])], body ? JSON.stringify(body) : undefined);
  return JSON.parse(out) as T;
}

interface EnvRow {
  key: string;
  type: string;
  target?: string[];
  updatedAt?: number;
}

for (const name of names) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is empty or unset in .env.local; nothing sent.`);
  const before = Date.now();
  api(`/v10/projects/${PROJECT}/env?upsert=true`, { key: name, value, type: plain ? "plain" : "sensitive", target: targets });
  const { envs } = api<{ envs: EnvRow[] }>(`/v9/projects/${PROJECT}/env`);
  const rows = envs.filter((e) => e.key === name);
  const covered = new Set(rows.flatMap((e) => e.target ?? []));
  const missing = targets.filter((t) => !covered.has(t));
  if (missing.length) throw new Error(`${name} saved, but Vercel lists it without ${missing.join(", ")}.`);
  const fresh = rows.some((e) => (e.updatedAt ?? 0) >= before - 60_000);
  console.log(`vercel-env: ${name} set on ${PROJECT} (${targets.join(", ")}, ${plain ? "plain" : "sensitive"})${fresh ? "" : "; note: Vercel's updatedAt didn't move"}.`);
}

if (redeploy) {
  const { deployments } = api<{ deployments: { uid: string; url: string; state: string; created: number }[] }>(
    `/v6/deployments?projectId=${PROJECT}&target=production&state=READY&limit=1`,
  );
  const current = deployments[0];
  if (!current) throw new Error("No ready production deployment to rebuild.");
  console.log(`vercel-env: rebuilding ${current.url} (production)…`);
  const out = vercel(["redeploy", current.url, "--environment", "production"]);
  const url = out.trim().split("\n").pop();
  console.log(`vercel-env: redeployed; ${url ?? "done"}.`);
}
