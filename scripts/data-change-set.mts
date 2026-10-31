/**
 * Opens and closes a pipeline's change set from a workflow (specs/data-platform/pipelines.md; one change set per run),
 * so several scripts in one run write into the same set: the first step opens it and prints its id, each script takes
 * `--change-set <id>`, the last step closes it.
 *
 *   node scripts/data-change-set.mts open  --source identity-refresh --run-ref "$GITHUB_RUN_ID" [--kind pipeline] [--reuse] [--summary '<json>'] [--store …]
 *   node scripts/data-change-set.mts close --id <n> --status applied|held [--reason "…"] [--summary '<json>'] [--store …]
 *
 * `open` prints the id alone on stdout (`id=$(node … open …)`); with `--reuse` it prints the newest set still open
 * with the same source and run reference instead of opening another (a job that continues a run). `close` fills the
 * counts from the versions written; `--summary` adds fields. `--store` is `supabase` (the default when
 * DATA_SUPABASE_URL is set) or `file:<dir>`. Exit 1 with the reason on stderr when the store refuses.
 */
import type { DataStore } from "./lib/data-platform/store.mts";
import { flagValue, storeFromFlag } from "./lib/data-platform/store.mts";
import { CHANGE_SET_SOURCES, isChangeSetSource } from "./lib/data-platform/change-set.mts";

export interface ChangeSetCliIo {
  store?: DataStore;
  env?: Readonly<Record<string, string | undefined>>;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

function parseSummary(text: string | undefined): object | undefined {
  if (text === undefined) return undefined;
  const v = JSON.parse(text) as unknown;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("--summary must be a JSON object");
  return v as object;
}

/** Runs the CLI on `argv` (without node and the script); returns the exit code. */
export async function changeSetCli(argv: readonly string[], io: ChangeSetCliIo = {}): Promise<number> {
  const out = io.out ?? ((l: string) => console.log(l));
  const err = io.err ?? ((l: string) => console.error(l));
  const [mode] = argv;
  try {
    const store = io.store ?? storeFromFlag(flagValue(argv, "--store"), io.env ?? process.env);
    if (mode === "open") {
      const kind = flagValue(argv, "--kind") ?? "pipeline";
      if (kind !== "pipeline") throw new Error(`--kind ${kind}: a workflow opens pipeline change sets (the import opens its own)`);
      const source = flagValue(argv, "--source");
      if (!source || !isChangeSetSource(source)) throw new Error(`--source must be one of ${CHANGE_SET_SOURCES.join(", ")}`);
      const runRef = flagValue(argv, "--run-ref");
      if (!runRef) throw new Error("--run-ref is required (the workflow's $GITHUB_RUN_ID)");
      const summary = parseSummary(flagValue(argv, "--summary"));
      if (argv.includes("--reuse")) {
        const open = await store.findOpen(source, runRef);
        if (open !== null) {
          err(`change set ${open} (${source}, run ${runRef}) is still open; reusing it`);
          out(String(open));
          return 0;
        }
      }
      const handle = await store.open("pipeline", source, runRef, summary);
      err(`opened change set ${handle.id} (${source}, run ${runRef})`);
      out(String(handle.id));
      return 0;
    }
    if (mode === "close") {
      const id = Number(flagValue(argv, "--id"));
      if (!Number.isInteger(id) || id <= 0) throw new Error("--id <n> is required");
      const status = flagValue(argv, "--status");
      if (status !== "applied" && status !== "held") throw new Error("--status must be applied or held");
      const reason = flagValue(argv, "--reason");
      if (status === "held" && !reason) throw new Error("a held change set needs --reason (the console shows it)");
      const handle = await store.attach(id);
      await handle.close(status, status === "held" ? reason : undefined, parseSummary(flagValue(argv, "--summary")));
      err(`closed change set ${id}: ${status}${status === "held" ? ` (${reason})` : ""}`);
      return 0;
    }
    throw new Error("usage: data-change-set.mts open|close …");
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  changeSetCli(process.argv.slice(2)).then((code) => process.exit(code));
}
