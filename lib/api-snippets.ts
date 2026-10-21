/**
 * The Data API's connection snippets and the small formatters its pages share (specs/product/data-api.md "MCP server",
 * "Pages"): the three ways to connect (curl, Claude Code, an `mcpServers` entry for Claude Desktop and Cursor through
 * mcp-remote), built from a site origin and a key, and the lines the keys table prints. Pure module (no Next imports),
 * so tests load it directly. Paths come from lib/api/routes.ts and limits from lib/api/keys.ts, never typed here.
 */
import { API_KEY_LIMITS } from "./api/keys.ts";
import { API_BASE, MCP_PATH } from "./api/routes.ts";

/** The public origin used where a page has no request to read one from (the static /developers page). */
export const DOCS_ORIGIN = "https://usequad.app";

/** What /developers shows in place of a real key. */
export const KEY_PLACEHOLDER = "quad_…";

/** A college the curl example asks for (Harvard). */
export const EXAMPLE_UNIT_ID = "166027";

export interface ConnectionSnippets {
  /** One request from a terminal. */
  curl: string;
  /** Claude Code's `claude mcp add`. */
  claudeCode: string;
  /** An `mcpServers` entry for Claude Desktop and Cursor, through mcp-remote. */
  mcpJson: string;
}

/** `origin` without a trailing slash. */
export function cleanOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/** The three connection snippets for `origin` with `key` (the real key, or {@link KEY_PLACEHOLDER}). */
export function connectionSnippets(origin: string, key: string): ConnectionSnippets {
  const base = cleanOrigin(origin);
  const mcpUrl = `${base}${MCP_PATH}`;
  return {
    curl: `curl -H "Authorization: Bearer ${key}" ${base}${API_BASE}/schools/${EXAMPLE_UNIT_ID}`,
    claudeCode: `claude mcp add --transport http quad ${mcpUrl} --header "Authorization: Bearer ${key}"`,
    // The header's value goes through an env variable (mcp-remote's README): some clients split an argument at its
    // space, which would break "Bearer <key>" written inline. The same form the spec's "Connecting" section gives.
    mcpJson: JSON.stringify(
      { mcpServers: { quad: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${QUAD_AUTH}"], env: { QUAD_AUTH: `Bearer ${key}` } } } },
      null,
      2,
    ),
  };
}

/** "12 of 5,000" for a key's requests today against the daily limit. */
export function usageLine(usedToday: number, perDay: number = API_KEY_LIMITS.perDay): string {
  return `${Math.round(usedToday).toLocaleString("en-US")} of ${perDay.toLocaleString("en-US")}`;
}

/** Whether another key may be made, given how many are active. */
export function canMakeKey(activeKeys: number): boolean {
  return activeKeys < API_KEY_LIMITS.keysPerUser;
}

/** "Oct 20, 2026" in UTC, so the server and the browser print the same day. */
export function keyDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}
