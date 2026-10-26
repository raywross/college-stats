/**
 * Grid edition files (data/common-app/grid/<cycle>_<updated>.json, `GridEdition`): the stable text the sync writes
 * (header keys first, one row per line, keys in `GridRow`'s order) and the newest file on disk.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GridEdition, GridRow } from "../../../lib/common-app/types.ts";

const EDITION_FILE = /^(\d{4}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/;

/** A row with its keys in the type's order. */
export function orderedRow(r: GridRow): GridRow {
  return {
    name: r.name,
    page: r.page,
    unit_id: r.unit_id,
    slug: r.slug,
    school_type: r.school_type,
    deadlines: { ed: r.deadlines.ed, ed2: r.deadlines.ed2, ea: r.deadlines.ea, ea2: r.deadlines.ea2, rea: r.deadlines.rea, regular: r.deadlines.regular },
    fee: { us: r.fee.us, international: r.fee.international },
    fee_waiver: r.fee_waiver,
    essay_required: r.essay_required,
    courses_grades_required: r.courses_grades_required,
    portfolio: r.portfolio,
    writing_supplement: r.writing_supplement,
    test_policy: { code: r.test_policy.code, tests_used: r.test_policy.tests_used, english_tests: r.test_policy.english_tests },
    recommendations: {
      teacher: r.recommendations.teacher,
      other: r.recommendations.other,
      counselor: r.recommendations.counselor,
      mid_year_report: r.recommendations.mid_year_report,
    },
    saves_forms: r.saves_forms,
  };
}

/** The edition file's text: 2-space JSON with one row (and one unmatched name) per line. */
export function editionFileText(e: GridEdition): string {
  const head = (["cycle", "updated", "source_url", "retrieved", "pages"] as const).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(e[k])}`);
  const rows = e.rows.map((r) => `    ${JSON.stringify(orderedRow(r))}`).join(",\n");
  const unmatched = e.unmatched.map((n) => `    ${JSON.stringify(n)}`).join(",\n");
  return `{\n${head.join(",\n")},\n  "rows": [\n${rows}\n  ],\n  "unmatched": [${unmatched ? `\n${unmatched}\n  ` : ""}]\n}\n`;
}

/** The newest edition file in `dir` (by cycle, then updated stamp), or null when there is none. */
export function newestEdition(dir: string): { cycle: string; updated: string; path: string; file: GridEdition } | null {
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir)
    .map((f) => ({ f, m: EDITION_FILE.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => !!x.m)
    .sort((a, b) => (a.m[1] + a.m[2] < b.m[1] + b.m[2] ? 1 : -1));
  if (!found.length) return null;
  const path = join(dir, found[0].f);
  return { cycle: found[0].m[1], updated: found[0].m[2], path, file: JSON.parse(readFileSync(path, "utf8")) as GridEdition };
}
