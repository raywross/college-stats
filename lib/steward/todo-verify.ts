/**
 * What an address answers when a To do row is marked Found (specs/product/todo-browser-agent.md "Step 2", item 2):
 * the console fetches it once, as the run would, and says in the row what came back, so a person or the assistant in
 * their browser learns at once whether the next run can fetch it. Pure: the fetch is lib/admin/todo-probe.ts's.
 *
 * Outcomes, from the first bytes and the status, never the URL: `document` (a PDF or an Office workbook), `page` (HTML:
 * a viewer, a sign-in page, an index), `blocked` (401, 403, 405, 429, or a bot challenge), `not-found` (404, 410),
 * `error` (a network failure, a timeout, a server error).
 */

export type VerifyOutcome = "document" | "page" | "blocked" | "not-found" | "error";

export interface Verdict {
  outcome: VerifyOutcome;
  /** The file's format when `document`. */
  format?: "pdf" | "xlsx";
  /** One clause for the attempt's record ("a PDF", "HTTP 403", "a bot challenge", "a web page"). */
  detail: string;
}

/** The attempt route a verification is recorded under. */
export const VERIFY_ROUTE = "verify";

const CHALLENGE = /<title>\s*just a moment\.{0,3}\s*<\/title>|\/cdn-cgi\/challenge-platform\/|cf-chl-|attention required! \| cloudflare|_incapsula_resource|px-captcha|captcha-delivery\.com|<title>\s*access denied\s*<\/title>/i;

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 4096)).toString("latin1");

/** The verdict for a status, its headers, and the first bytes of the body. */
export function classifyAnswer(a: { status: number; headers: { get(name: string): string | null }; head: Uint8Array }): Verdict {
  const text = latin1(a.head);
  if (text.startsWith("%PDF")) return { outcome: "document", format: "pdf", detail: "a PDF" };
  if (text.startsWith("PK\u0003\u0004")) return { outcome: "document", format: "xlsx", detail: "a workbook" };
  if (CHALLENGE.test(text) || (a.status === 503 && a.headers.get("cf-mitigated"))) return { outcome: "blocked", detail: "a bot challenge" };
  if (a.status === 401 || a.status === 403 || a.status === 405 || a.status === 429) return { outcome: "blocked", detail: `HTTP ${a.status}` };
  if (a.status === 404 || a.status === 410) return { outcome: "not-found", detail: `HTTP ${a.status}` };
  if (a.status >= 500) return { outcome: "error", detail: `HTTP ${a.status}` };
  if (a.status >= 400) return { outcome: "error", detail: `HTTP ${a.status}` };
  const type = (a.headers.get("content-type") ?? "").toLowerCase();
  if (/text\/html|application\/xhtml|^\s*$/.test(type) || /^\s*<(!doctype|html|head|body|\?xml)/i.test(text)) return { outcome: "page", detail: "a web page" };
  return { outcome: "page", detail: type ? `${type.split(";")[0]}, not a file we read` : "something other than a document" };
}

/**
 * Whether an address is one the console may fetch on an admin's word: http(s), and a host that isn't the machine
 * itself or a private network (a loopback, link-local, or RFC 1918 address, `localhost`, a `.internal` or `.local`
 * name). The console runs on a host with neighbours; a To do row never names one.
 */
export function isPublicAddress(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host.includes(":")) {
    // IPv6: only a plain global address; the loopback, link-local, unique-local and mapped forms are refused.
    return !/^(::1?$|fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:|::ffff:)/i.test(host);
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
  }
  return !(host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || !host.includes("."));
}

/** The verdict for an address the console won't fetch. */
export const NOT_PUBLIC: Verdict = { outcome: "error", detail: "not a public address" };

/** A verdict for a failed fetch (no answer at all). */
export function errorVerdict(err: unknown): Verdict {
  const text = err instanceof Error ? err.message : String(err);
  const detail = /abort|timeout|timed out/i.test(text) ? "no answer in time" : /ENOTFOUND|getaddrinfo/i.test(text) ? "no such host" : "no answer";
  return { outcome: "error", detail };
}

/** The attempt's record: "a PDF answers", "HTTP 403: the host refuses machines", … */
export function verdictRecord(v: Verdict): string {
  switch (v.outcome) {
    case "document":
      return `${v.detail} answers`;
    case "page":
      return `${v.detail} answers, not a file`;
    case "blocked":
      return `${v.detail}: the host refuses machines`;
    case "not-found":
      return `${v.detail}: nothing at that address for us`;
    default:
      return `couldn't check: ${v.detail}`;
  }
}

/** The sentence after "Found." that says what happens next. */
export function verdictMessage(v: Verdict | null): string {
  if (!v) return "Found. The next run of this college fetches it.";
  switch (v.outcome) {
    case "document":
      return `Found. ${cap(v.detail)} answers at that address; the next run of this college fetches it.`;
    case "page":
      return `Found, but the address answers with ${v.detail}, not a file. A viewer or a sign-in page gives the run the same; if you can, find the file's own link and mark Found again.`;
    case "blocked":
      return `Found, but the host refuses machines (${v.detail}), so the run can't fetch it. The file has to come by hand: download it in your browser and add it with archive-doc.`;
    case "not-found":
      return `Found, but the address answers ${v.detail} to us. If it opens in your browser, the site treats machines differently and the file has to come by hand.`;
    default:
      return `Found. The address couldn't be checked from here (${v.detail}); the next run of this college tries it.`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
