/**
 * Value labels from an IPEDS data dictionary (`{FILE}_Dict.zip`, an .xlsx whose "Frequencies" sheet lists every code a
 * variable takes in that file with NCES's label). Used for RELAFFIL (specs/religious-life.md), so the religious
 * affiliation labels shown on the site are NCES's own, from the same release as the codes, never typed by hand.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkbook, type Workbook } from "./cds-xlsx.mts";
import { fetchIpedsZip } from "./ipeds.mts";

/**
 * `variable`'s code → label from the dictionary's Frequencies sheet (header row: VarName, …, CodeValue, valuelabel).
 * Throws when the sheet or its columns are missing, or the variable has no rows, so a changed layout fails the sync.
 */
export function valueLabelsFrom(book: Workbook, variable: string): Map<number, string> {
  const sheet = book.get("FREQUENCIES");
  if (!sheet) throw new Error(`no Frequencies sheet (sheets: ${[...book.keys()].join(", ")})`);
  const header = new Map((sheet.get(1) ?? []).map((c) => [String(c.value).trim().toLowerCase(), c.col]));
  const [varCol, codeCol, labelCol] = ["varname", "codevalue", "valuelabel"].map((h) => header.get(h));
  if (!varCol || !codeCol || !labelCol) throw new Error(`Frequencies sheet has no VarName/CodeValue/valuelabel header`);
  const labels = new Map<number, string>();
  for (const [r, cells] of sheet) {
    if (r === 1) continue;
    const at = (col: string) => cells.find((c) => c.col === col)?.value;
    if (String(at(varCol) ?? "").trim().toUpperCase() !== variable.toUpperCase()) continue;
    const code = Number(at(codeCol));
    const label = String(at(labelCol) ?? "").trim();
    if (!Number.isInteger(code) || !label) throw new Error(`${variable}: row ${r} has no code or label`);
    labels.set(code, label);
  }
  if (!labels.size) throw new Error(`${variable} is not in the Frequencies sheet`);
  return labels;
}

/** The labels of `variable` in the dictionary of IPEDS file `fileName` (e.g. "IC2025"), and the dictionary's URL. */
export async function fetchValueLabels(fileName: string, variable: string, cacheDir: string): Promise<{ url: string; labels: Map<number, string> }> {
  const name = `${fileName}_Dict`;
  const got = await fetchIpedsZip(name, cacheDir);
  if (!got) throw new Error(`NCES has no ${name}.zip`);
  const entries = execFileSync("unzip", ["-Z1", got.zip], { encoding: "utf8" }).split("\n").filter((f) => /\.xlsx$/i.test(f));
  if (!entries[0]) throw new Error(`${name}.zip has no .xlsx`);
  const xlsx = join(mkdtempSync(join(tmpdir(), "ipeds-dict-")), entries[0]);
  writeFileSync(xlsx, execFileSync("unzip", ["-p", got.zip, entries[0]], { maxBuffer: 64 * 1024 * 1024 }));
  return { url: got.url, labels: valueLabelsFrom(readWorkbook(xlsx), variable) };
}
