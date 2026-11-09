/**
 * One fetch of a Found address, as the run would make it (specs/product/todo-browser-agent.md "Step 2", item 2): the
 * pipeline's own user agent, one redirect chain, a short deadline, and only the first bytes read, so the console can
 * say what answers there (lib/steward/todo-verify.ts) without downloading a document. robots.txt isn't consulted: the
 * run fetches a Common Data Set file regardless (owner decision 2026-10-10, scripts/lib/college-reported/http.mts),
 * and this is one request at a person's press. An address on the console's own machine or a private network is never
 * fetched (`isPublicAddress`). Server code.
 */
import { NOT_PUBLIC, classifyAnswer, errorVerdict, isPublicAddress, type Verdict } from "../steward/todo-verify.ts";

/** The pipeline's identity (scripts/lib/college-reported/http.mts `USER_AGENT`; tests/steward-todo-run.test.mts checks they agree). */
export const PROBE_USER_AGENT = "QuadCollegeData/1.0 (college admissions figures; +https://college-stats-nine.vercel.app/data)";
/** How long one check may take: a Server Action's own budget is short. */
export const PROBE_TIMEOUT_MS = 8_000;
/** Bytes read: enough for a PDF's header, a workbook's signature, or a challenge page's title. */
export const PROBE_HEAD_BYTES = 4_096;

export async function probeDocument(url: string, fetchFn: typeof fetch = fetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<Verdict> {
  if (!isPublicAddress(url)) return NOT_PUBLIC;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { headers: { "User-Agent": PROBE_USER_AGENT, Accept: "application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html;q=0.8,*/*;q=0.5" }, redirect: "follow", signal: controller.signal });
    const head = await readHead(res, PROBE_HEAD_BYTES);
    return classifyAnswer({ status: res.status, headers: res.headers, head });
  } catch (e) {
    return errorVerdict(e);
  } finally {
    clearTimeout(timer);
  }
}

/** The first `max` bytes of a body, then the stream is cancelled. */
async function readHead(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, out.length - at);
    out.set(c.subarray(0, n), at);
    at += n;
    if (at >= out.length) break;
  }
  return out;
}
