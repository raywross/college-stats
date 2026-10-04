/**
 * A fake extraction answer in the shape the answer schema asks for (lib/cds-sections.ts schemaFor):
 * `{"values": [{"code", "v", "lines"}, ...]}`, built from the code-keyed form tests find easier to write.
 */
export function answerJson(byCode: Record<string, { v: unknown; lines: number[] }>): string {
  return JSON.stringify({ values: Object.entries(byCode).map(([code, e]) => ({ code, v: e.v, lines: e.lines })) });
}

/** The codes a request asks for: its system prompt's code table ("C.101 | question | type"), in order. */
export function askedCodes(params: { system?: unknown }): string[] {
  const system = Array.isArray(params.system) ? (params.system as { text: string }[]).map((b) => b.text).join("\n") : String(params.system ?? "");
  return [...system.matchAll(/^([A-J]\.[0-9A-Z]{2,5}) \|/gm)].map((m) => m[1]);
}
