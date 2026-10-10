/**
 * Guards every model call against lone UTF-16 surrogates (text cut mid-emoji by a `slice`, or a malformed page):
 * `JSON.stringify` emits an unpaired half as `\ud8xx`, which the API rejects with "The request body is not valid
 * JSON: no low surrogate in string" (the crash this fixes; the batch submit never got a response, so nothing was
 * spent). `toWellFormedDeep` deep-maps every string in a request through `String.prototype.toWellFormed()` (ES2024,
 * available in Node 20+; this repo targets Node 24 with `lib: ["esnext"]`) so the body reaching the API is always
 * valid JSON. Pure; applied at both chokepoints a request leaves this code: batch `submit` (batch.mts) and the
 * interactive `client` wrapper (phases.mts, pipeline.mts).
 */

/** Runtime fallback for an engine whose `String.prototype` lacks `toWellFormed`: replace any UTF-16 code unit that
 * isn't part of a valid surrogate pair with U+FFFD, by hand. */
function wellFormed(s: string): string {
  const native = (s as unknown as { toWellFormed?: () => string }).toWellFormed;
  if (typeof native === "function") return native.call(s);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else {
        out += "�";
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += "�";
    } else {
      out += s[i];
    }
  }
  return out;
}

/** Deep-maps every string inside `value` through `wellFormed`; arrays, plain objects, and other types pass through
 * unchanged in shape. Safe to call on anything JSON-shaped, including an SDK request body. */
export function toWellFormedDeep<T>(value: T): T {
  if (typeof value === "string") return wellFormed(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => toWellFormedDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toWellFormedDeep(v);
    return out as T;
  }
  return value;
}
