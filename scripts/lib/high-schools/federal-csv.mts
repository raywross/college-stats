/**
 * Streaming readers for the federal high school files (CCD, EDGE, EDFacts, CRDC). NCES's CCD membership file is
 * 2.3 GB of CSV inside a 200 MB zip: too big for one string (scripts/lib/ipeds.mts `forEachCsvRow` reads whole files),
 * so these read a zip entry line by line through the system `unzip`, like context.mts does.
 *
 * A "source" is a cached zip or, for tests, a directory holding files named like the zip's entries.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

/** One CSV line → cells. Quotes ("a, b", doubled "" inside) as RFC 4180; `sep` is "," or "|" (EDGE). */
export function splitCsvLine(line: string, sep = ","): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

/** Whether a line ends inside a quoted field (a field with an embedded newline continues on the next line). */
export function openQuote(line: string, sep = ","): boolean {
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else atStart = c === sep;
  }
  return quoted;
}

export interface CsvReadOptions {
  /** Field separator; default ",". */
  sep?: string;
  /** Column names when the file has no header row (EDGE's TXT). */
  columns?: readonly string[];
  /** Default "utf8" (CCD's 2024–25 files are ASCII, EDGE's are UTF-8). */
  encoding?: BufferEncoding;
}

function entryStream(source: string, entry: string): { stream: Readable; done: Promise<void> } {
  if (existsSync(source) && statSync(source).isDirectory()) {
    const stream = createReadStream(join(source, entry));
    return { stream, done: new Promise((res, rej) => stream.on("close", () => res()).on("error", rej)) };
  }
  const child = spawn("unzip", ["-p", source, entry], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  const done = new Promise<void>((res, rej) =>
    child.on("close", (code) => (code === 0 ? res() : rej(new Error(`unzip -p ${source} "${entry}" exited ${code}: ${err.trim()}`)))),
  );
  return { stream: child.stdout, done };
}

/**
 * Every record of one CSV inside a zip (or a test directory), as { HEADER: cell } with upper-case, trimmed headers
 * and trimmed cells. Streams: memory stays flat whatever the file size.
 */
export async function* readCsvRecords(source: string, entry: string, opts: CsvReadOptions = {}): AsyncGenerator<Record<string, string>> {
  const sep = opts.sep ?? ",";
  const { stream, done } = entryStream(source, entry);
  stream.setEncoding(opts.encoding ?? "utf8");
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = opts.columns ? opts.columns.map((c) => c.toUpperCase()) : null;
  let pending = "";
  for await (const raw of rl) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if (openQuote(line, sep)) {
      pending = line;
      continue;
    }
    pending = "";
    if (!line.trim()) continue;
    const cells = splitCsvLine(header ? line : line.replace(/^﻿/, ""), sep);
    if (!header) {
      header = cells.map((h) => h.trim().toUpperCase());
      continue;
    }
    const rec: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = (cells[i] ?? "").trim();
    yield rec;
  }
  await done;
}

/** "2024–25" for "2024-2025" or "2024-25" (en dash, the site's year style). */
export function schoolYearLabel(raw: string): string | null {
  const m = /^(\d{4})\s*[-–]\s*(\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const end = m[2].length === 4 ? m[2].slice(2) : m[2];
  return `${m[1]}–${end}`;
}
