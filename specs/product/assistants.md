# Assistants: Quad in ChatGPT, Claude, and Gemini

> Status: **built** 2026-10-20 on `feature/quad-mcp` from the owner's request ("an instructions page to add Quad as a
> skill to ChatGPT, Claude, and Gemini, specific instructions for each"), and **merged 2026-10-21** with the keyed Data
> API and MCP server ([data-api.md](data-api.md)), built the same day in another chat. Part of [product](README.md).
> This document covers what the assistants' menus need: the keyless address, the skill file, and `/connect`. The
> server, its tools, keys, and the REST API are data-api.md's.

## Goal
A family that uses an assistant can ask it about colleges and get Quad's numbers with Quad's citations, not the
assistant's memory. One public address works for all three assistants, a skill file teaches any of them how to use
Quad well, and `/connect` gives the steps for each.

## Research (2026-10-20)
What changed this year, from the three vendors' help pages (fetched where the environment allowed, else their search
snippets; the page flags what's uncertain):
- **MCP is the common denominator.** ChatGPT (sidebar **Plugins → + → Add custom MCP server**; Business, Enterprise,
  and Edu admins, Pro read-only, Plus uncertain), Claude (**Customize → Connectors → Add custom connector**; every
  plan, Free included, with a documented prefilled install link), the Gemini app (**Settings → Connected apps → add
  custom app**; Google AI Pro and Ultra, U.S., 18+, part of Spark), Gemini CLI (`httpUrl` in `settings.json`) and
  Antigravity CLI (`serverUrl`) all take a Streamable HTTP server URL; "no authentication" is accepted everywhere for
  public data, and none of these menus can add a header. Tools need `title`, `readOnlyHint`, `openWorldHint`;
  ChatGPT's deep research needs tools named `search` and `fetch` with its result shapes.
- **One skill file fits all three.** Claude, ChatGPT's workspace plans, and Gemini's new Skills (rolled out 30 Sep
  2026, replacing Gems from 17 Nov) upload the same Agent Skills format: a folder named after the skill with
  `SKILL.md` (frontmatter `name`, `description`), zipped as the folder.
- **Custom GPTs are a dead end.** OpenAI is retiring them on 11 Dec 2026 and personal accounts can't create new ones;
  their OpenAPI Actions don't migrate to plugins. So no "make a GPT" steps.
- **Nothing reads `llms.txt` or OpenAPI on its own.** The only auto-discovered thing is the MCP server itself.

## Why two addresses for one server
The Data API's owner decision (2026-10-20) is that nothing is open to anonymous callers: a key per person, limits per
key, usage on the account page. The assistants' menus can't send a key. Rather than two servers (the first build had
its own JSON-RPC server and keyless REST routes), the merge kept one tool set with two front doors:
- **`/api/mcp`** with `Authorization: Bearer quad_…` (data-api.md): a person's own limits, for Claude Code, Claude
  Desktop, Cursor, and anyone with a key.
- **`/mcp`** with no key: the same ten tools, limited to a minute's burst of 60 requests per calling address
  (`lib/api/mcp-route.ts createPublicMcpRoute`, `PUBLIC_MCP_LIMIT`), `429` with `Retry-After` over it and a message
  naming the keyed address. Every tool call is recorded as `api_request` with an empty `key_id`, so usage of the free
  door is visible beside keyed usage. This is the address `/connect` hands out.

The keyless REST routes of the first build (`/api/v1/colleges`, `/compare`, `/glossary`) are gone; the REST API is
keyed only. What a signed-out assistant gets is exactly what the signed-out site shows: no estimate, no level, no odds,
no planner data, no hidden field (data-api.md's serializers and `tests/api-v1.test.mts` guard this for every tool).

## What's built here
### The three tools the assistants need beyond the Data API's seven
In `lib/api/mcp.ts`, registered after the seven and documented in `lib/api/routes.ts MCP_TOOLS` and data-api.md's
table (the tests hold the three in step):
| Tool | Input | Returns |
|---|---|---|
| `search` | `query` | `{results: [{id, title, url}]}` (ChatGPT deep-research shape) over the site's own search (`searchSchools`: aliases and nicknames first) |
| `fetch` | `id` | `{id, title, text, url, metadata}`; `text` is the college as lines, one per public value, each with its source and year, grouped by topic (`publicSchool` values, `schoolLineage` citations, `fieldRegistry` labels); `metadata` is the summary row plus the attribution and the retrieved date |
| `glossary` | `term?` | the glossary less the "Your account" category |

Links use the request's own origin (a preview deploy links to itself); without one, the production address.

### The skill, `GET /connect/quad-skill.zip`
`lib/api/skill.ts` writes `quad/SKILL.md` (Agent Skills frontmatter; the deployment's addresses in `metadata`: the
keyless `mcp`, `mcp_with_key`, and `api`; how to reach Quad: the connector, then the keyed API with a person's own key,
then the public pages; how to speak about what Quad says: carry the citation, link the page, tiers are words, never
odds, "not reported" isn't zero, which cost is which, the attribution line) and `lib/api/zip.ts` stores it as a zip
(store method, fixed timestamp, deterministic bytes, no dependency). Built per request so the addresses are right;
paths and limits come from `lib/api/routes.ts` and `lib/api/keys.ts`, never typed in.

### `/connect`
`app/connect/page.tsx` with `components/connect/ConnectAddresses.tsx` (client; reads `window.location.origin` for the
MCP address, the skill link, the OpenAPI link, Claude's prefilled install link, and the CLI snippets, each with Copy;
paths from `lib/api/routes.ts`). Sections: the three addresses; Claude (connector with the install button, the skill,
the Team/Enterprise note); ChatGPT (Plugins → Add custom MCP server, the skill, the Plus and GPT-retirement note, the
`search`/`fetch` line); Gemini (Connected apps, Skills, a Gem until November, the CLI snippets folded); what the
assistant can and can't see; for developers (the key, the daily limit from `API_KEY_LIMITS`, a link to `/developers`).
Linked from the footer; `/developers` names `/mcp` as the one keyless address and links back. The page says its steps
are as of this writing and links each vendor's help.

## Rules
- The keyless door shows what a signed-out visitor sees and nothing more: no estimate, no level, no odds, no planner
  data, no hidden field. A tool that would need a person's numbers doesn't exist here.
- Every value carries its source and year from lineage; the `instructions` and the skill tell the assistant to repeat
  them. No data year is hard-coded in the code or the skill text (the citation guards cover `lib/api/`).
- Read-only, idempotent; no action is ever taken on anyone's behalf.
- No vendor-specific menu wording lives in code; it is page copy, dated, with the help links beside it.
- No path or limit is typed into a page or the skill: `MCP_PUBLIC_PATH`, `MCP_PATH`, `API_BASE`, `API_KEY_LIMITS`.

## Owner setup
Nothing for this part: `/mcp`, `/connect`, and the skill work on every deploy with no database. The keyed side needs
the `api_keys` migration (data-api.md). Optional, when wanted:
1. **Directory listings** (so people find Quad without this page): Claude at `claude.ai/directory/manage` (any paid
   plan; needs the privacy page, a docs page (`/connect`), a support contact, an icon); ChatGPT's plugin directory
   from the OpenAI Platform dashboard (identity verification, logo, privacy URL, test prompts). Both want the
   keyless MCP URL and the tool annotations already set.
2. **A custom domain** before publishing anywhere: the addresses on `/connect` follow the site's origin, so listings
   submitted from the `.vercel.app` address would break when the domain changes.

## Files
`lib/api/mcp.ts` (`search`, `fetch`, `glossary`, `collegeDocument`, `glossaryTerms`), `lib/api/mcp-route.ts`
(`createPublicMcpRoute`, `PUBLIC_MCP_LIMIT`), `lib/api/routes.ts` (`MCP_PUBLIC_PATH`, the three tool rows),
`lib/api/skill.ts`, `lib/api/zip.ts`, `app/mcp/route.ts`, `app/connect/page.tsx`, `app/connect/quad-skill.zip/route.ts`,
`components/connect/ConnectAddresses.tsx`, `components/layout/Footer.tsx` (link). Tests: `tests/assistants.test.mts`;
the tool table and parity checks are `tests/api-mcp.test.mts`'s.

## Open questions
1. A signed-in tool set (`my_plan`: the assistant reading your list and next steps) needs OAuth on `/api/mcp`
   (data-api.md open question 1); the lazy-auth pattern (public tools open, sign-in on demand) is supported by Claude
   and ChatGPT.
2. Should Explore's `near`/`within` be exposed to assistants? They are, through `search_colleges`' REST twin
   (`/api/v1/schools?near=`); the MCP `search_colleges` tool doesn't take them yet. A ZIP, no account; a home address
   is never read.
