/**
 * A fake of the SDK's `client.messages.stream(...)` for the essay reader (lib/essays/review.ts `ReviewClient`): the
 * final message's text replayed as `text_delta` events in chunks of `chunk` characters (after an empty thinking block,
 * as adaptive thinking streams it), then `message_delta` with the stop reason and usage, then `finalMessage()`. An
 * `error` rejects after `failAfter` chunks, as a stream that breaks mid-answer. Never calls the API.
 */
import type Anthropic from "@anthropic-ai/sdk";

export interface FakeStreamOptions {
  chunk?: number;
  /** Throw this from the stream (after `failAfter` text chunks, default 0: before any event). */
  error?: unknown;
  failAfter?: number;
}

export function fakeStream(message: Anthropic.Message, opts: FakeStreamOptions = {}) {
  const chunk = Math.max(1, opts.chunk ?? 7);
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  async function* events(): AsyncGenerator<Anthropic.MessageStreamEvent> {
    if (opts.error !== undefined && !opts.failAfter) throw opts.error;
    yield { type: "message_start", message: { ...message, content: [], stop_reason: null } } as unknown as Anthropic.MessageStreamEvent;
    yield { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } } as unknown as Anthropic.MessageStreamEvent;
    yield { type: "content_block_stop", index: 0 } as Anthropic.MessageStreamEvent;
    yield { type: "content_block_start", index: 1, content_block: { type: "text", text: "", citations: null } } as unknown as Anthropic.MessageStreamEvent;
    let sent = 0;
    for (let i = 0; i < text.length; i += chunk) {
      if (opts.error !== undefined && sent === opts.failAfter) throw opts.error;
      yield { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(i, i + chunk) } } as Anthropic.MessageStreamEvent;
      sent++;
    }
    if (opts.error !== undefined) throw opts.error;
    yield { type: "content_block_stop", index: 1 } as Anthropic.MessageStreamEvent;
    yield { type: "message_delta", delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: message.usage } as unknown as Anthropic.MessageStreamEvent;
    yield { type: "message_stop" } as Anthropic.MessageStreamEvent;
  }
  let consumed = false;
  return {
    [Symbol.asyncIterator]() {
      consumed = true;
      return events();
    },
    async finalMessage(): Promise<Anthropic.Message> {
      if (!consumed) for await (const e of { [Symbol.asyncIterator]: events }) void e;
      return message;
    },
  };
}
