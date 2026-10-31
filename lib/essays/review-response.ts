/**
 * POST /api/essays/review's response (specs/product/essays/reviewer.md "Changed (owner, 2026-10-31): the notes stream
 * in"): `handleReview` answers every check before the model call as JSON; its first event means the read started, and
 * from then the response is the events as NDJSON, one JSON object per line, each written as it is sent. The read
 * finishes (and is recorded) even when the browser leaves.
 *
 * Pure apart from the web Response and ReadableStream; tested in tests/essays-review-stream.test.mts.
 */
import type { Reply, ReviewStreamEvent } from "./review.ts";

/** A read's events: NDJSON, never cached or transformed, and no proxy buffering (each line goes out as it is sent). */
export const STREAM_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

type JsonReply = Extract<Reply, { body: unknown }>;

/**
 * Runs the decision with a `send` that streams; returns the JSON reply's Response (made by `json`) when the decision
 * refused before the read, else the NDJSON stream.
 */
export async function reviewResponse(run: (send: (e: ReviewStreamEvent) => void) => Promise<Reply>, json: (r: JsonReply) => Response): Promise<Response> {
  const encoder = new TextEncoder();
  const pending: Uint8Array[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let started!: () => void;
  const startedP = new Promise<null>((resolve) => (started = () => resolve(null)));
  const send = (e: ReviewStreamEvent) => {
    const line = encoder.encode(`${JSON.stringify(e)}\n`);
    if (!controller) pending.push(line);
    else {
      try {
        controller.enqueue(line);
      } catch {
        // The reader left; the read still finishes and is recorded.
      }
    }
    started();
  };
  const done = run(send);
  const first = await Promise.race([done, startedP]);
  if (first && !("streamed" in first)) return json(first);

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const line of pending.splice(0)) c.enqueue(line);
      const close = () => {
        try {
          c.close();
        } catch {
          // Already closed by the reader leaving.
        }
      };
      done.then(close, close);
    },
  });
  return new Response(stream, { status: 200, headers: STREAM_HEADERS });
}

/** The browser's side: splits streamed text into whole lines, however the chunks fall; a partial line waits. */
export function lineSplitter(): { push(chunk: string): string[]; end(): string[] } {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      return parts.filter((l) => l.trim() !== "");
    },
    end() {
      const rest = buffer.trim();
      buffer = "";
      return rest ? [rest] : [];
    },
  };
}
