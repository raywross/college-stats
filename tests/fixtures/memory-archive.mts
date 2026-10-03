/**
 * An in-memory archive (scripts/lib/college-reported/archive.mts `Archive`) for tests: bytes and line sidecars in maps,
 * locations "mem:<sha>.<ext>", and a log of every `get` so a test can tell an archive read from a fetch.
 */
import type { Archive } from "../../scripts/lib/college-reported/archive.mts";
import { sha256 } from "../../scripts/lib/college-reported/http.mts";

export function memoryArchive(): Archive & { bytes: Map<string, Uint8Array>; lines: Map<string, unknown>; gets: string[]; puts: string[] } {
  const bytes = new Map<string, Uint8Array>();
  const lines = new Map<string, unknown>();
  const gets: string[] = [];
  const puts: string[] = [];
  return {
    backend: "local",
    bytes,
    lines,
    gets,
    puts,
    async has(sha) {
      return bytes.has(sha);
    },
    async get(sha) {
      gets.push(sha);
      return bytes.get(sha) ?? null;
    },
    async put(sha, b, ext) {
      if (sha256(b) !== sha) throw new Error(`archive: bytes don't hash to ${sha}`);
      if (!bytes.has(sha)) puts.push(sha);
      bytes.set(sha, b);
      return `mem:${sha}.${ext}`;
    },
    async putLines(sha, l) {
      lines.set(sha, structuredClone(l));
      return `mem:${sha}.lines.json.gz`;
    },
    async getLines<T>(sha: string) {
      return (lines.has(sha) ? structuredClone(lines.get(sha)) : null) as T | null;
    },
  };
}
