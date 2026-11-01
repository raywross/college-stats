#!/usr/bin/env node
// Restores archived visit_events rows (specs/product/visit-events: the archive of past and removed events) into a
// Supabase project. Usage: SUPABASE_DB_URL=postgres://… node restore-visit-events.mjs visit-events-archive-<date>.ndjson.gz
// Needs the `postgres` package (npm i postgres). Rows already present (same id) are left alone.
import postgres from "postgres";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import readline from "node:readline";

const [file] = process.argv.slice(2);
const url = process.env.SUPABASE_DB_URL;
if (!file || !url) { console.error("usage: SUPABASE_DB_URL=… node restore-visit-events.mjs <archive.ndjson.gz>"); process.exit(1); }
const sql = postgres(url, { max: 1, ssl: "require", prepare: false });
try {
  const rl = readline.createInterface({ input: createReadStream(file).pipe(createGunzip()) });
  let batch = [], inserted = 0, read = 0;
  const flush = async () => {
    if (!batch.length) return;
    const res = await sql`insert into public.visit_events ${sql(batch)} on conflict (id) do nothing`;
    inserted += res.count; batch = [];
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line)); read++;
    if (batch.length >= 1000) await flush();
  }
  await flush();
  console.log(`read ${read} rows, inserted ${inserted} (the rest already existed)`);
} finally { await sql.end(); }
