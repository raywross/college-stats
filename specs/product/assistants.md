# Assistants: Quad in ChatGPT, Claude, and Gemini

> Status: **built** 2026-10-20 on `feature/quad-mcp` from the owner's request ("an instructions page to add Quad as a
> skill to ChatGPT, Claude, and Gemini, specific instructions for each", and "build it here now" when no MCP service
> existed). Part of [product](README.md). The keyed data API with history, lineage, and bulk downloads stays planned in
> [data-api.md](data-api.md); this is the free, read-only, assistant-facing surface it will build on.

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
  public data. Tools need `title`, `readOnlyHint`, `destructiveHint`, `openWorldHint`; ChatGPT's deep research needs
  tools named `search` and `fetch` with its result shapes.
- **One skill file fits all three.** Claude, ChatGPT's workspace plans, and Gemini's new Skills (rolled out 30 Sep
  2026, replacing Gems from 17 Nov) upload the same Agent Skills format: a folder named after the skill with
  `SKILL.md` (frontmatter `name`, `description`), zipped as the folder.
- **Custom GPTs are a dead end.** OpenAI is retiring them on 11 Dec 2026 and personal accounts can't create new ones;
  their OpenAPI Actions don't migrate to plugins. So no "make a GPT" steps; the OpenAPI document is published for
  developers and for workspaces that still want an action until then.
- **Nothing reads `llms.txt` or OpenAPI on its own.** The only auto-discovered thing is the MCP server itself.

## What's built
### The MCP server, `POST /mcp` (also `/api/mcp`)
`lib/api/mcp.ts` (pure JSON-RPC 2.0 over a parsed body) and `app/api/mcp/route.ts` (HTTP), re-exported at
`app/mcp/route.ts`. Stateless Streamable HTTP: every request answered as JSON, no session, no server-to-client stream
(GET is 405, DELETE 200, OPTIONS the CORS preflight). Protocol revisions 2025-06-18 and 2025-03-26 (the newest offered
to a client asking for one it doesn't know); batches accepted for older clients; notifications get 202 and nothing else.
`initialize` returns `instructions` telling the assistant what Quad is, which tool to reach for, to repeat the source
and year, and that Quad never gives a person's odds.

Seven tools, all annotated `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`:
| Tool | Input | Returns |
|---|---|---|
| `search` | `query` | `{results: [{id, title, url}]}` (ChatGPT deep-research shape) |
| `fetch` | `id` | `{id, title, text, url, metadata}`; `text` is the facts as plain lines, each with its source and year |
| `find_colleges` | `query`, `state?`, `limit?` | the site's own search (`searchSchools`: aliases and nicknames first), as summaries |
| `college_facts` | `college` (unit id or name), `sections?` | the Compare table's rows for one college, grouped as the site groups them, each value with `source {label, publisher, year, url, quote?}` |
| `compare_colleges` | `unit_ids` (2–4) | one row per metric, a value and its year per college |
| `explore_colleges` | `filters` (Explore's own parameters), `limit?`, `page?` | `getSchools(parseFilters(...))`, paged; `forMe` is dropped |
| `glossary` | `term?` | the glossary less the "Your account" category |

Every value is the one the site shows: the facts are `TABLE_GROUPS` rows (`lib/compare-topics.ts`) formatted by the
same `fmt`, cited by `citeField` with `admissionProfileCellField` for the CDS cells, so the API never computes
separately. Hidden fields are dropped by iterating `HIDDEN_FIELDS`, and the raw `School` record never leaves the
server (it carries `selectivity.band`). Quad's selectivity tier is words from `tierText`. Nothing under `lib/api/`,
`app/api/mcp/`, `app/api/v1/` or `app/mcp/` imports the estimate, the selectivity index, the planner, or the admin
code (`tests/mcp.test.mts` guard).

### The plain endpoints, `/api/v1`
`GET /api/v1/colleges?q=` (search) or with Explore's filters (paged, 50 max); `GET /api/v1/colleges/{unit_id}?sections=`;
`GET /api/v1/compare?ids=`; `GET /api/v1/glossary?term=`; `GET /api/v1/openapi.json` (OpenAPI 3.1 with the request's
origin as `servers`, unique `operationId`s). Responses carry `X-Dataset-Publish` (the dataset's retrieved date),
`Cache-Control: public, max-age=300, s-maxage=3600`, and CORS `*`.

### Limits and privacy
`lib/api/http.ts`: one in-memory limiter per server instance (`lib/chances/rate-limit.ts`), 60 requests a minute per
address with a one-a-second refill, counting tool calls and the dynamic GETs; `429` with `Retry-After`. No key, no
auth, no telemetry event yet (the planned `api_request` event in [telemetry.md](telemetry.md) would record endpoint and
status, never the query). Links in every response use the request's own origin, so a preview deploy links to itself.

### The skill, `GET /connect/quad-skill.zip`
`lib/api/skill.ts` writes `quad/SKILL.md` (Agent Skills frontmatter; the deployment's addresses in `metadata`; how to
reach Quad with and without the connection; how to speak about what Quad says: carry the citation, link the page,
tiers are words, never odds, "not reported" isn't zero, which cost is which) and `lib/api/zip.ts` stores it as a zip
(store method, fixed timestamp, deterministic bytes, no dependency). Built per request so the addresses are right.

### `/connect`
`app/connect/page.tsx` with `components/connect/ConnectAddresses.tsx` (client; reads `window.location.origin` for the
MCP address, the skill link, the OpenAPI link, Claude's prefilled install link, and the CLI snippets, each with Copy).
Sections: the three addresses; Claude (connector with the install button, the skill, the Team/Enterprise note);
ChatGPT (Plugins → Add custom MCP server, the skill, the Plus and GPT-retirement note, the `search`/`fetch` line);
Gemini (Connected apps, Skills, a Gem until November, the CLI snippets folded); what the assistant can and can't see;
developers. Linked from the footer. The page says its steps are as of this writing and links each vendor's help.

## Rules
- The API shows what a signed-out visitor sees and nothing more: no estimate, no level, no odds, no planner data,
  no hidden field. A tool that would need a person's numbers doesn't exist here.
- Every value carries its source and year from lineage; the `instructions` and the skill tell the assistant to repeat
  them. No data year is hard-coded in the code or the skill text (the citation guards cover `lib/api/`).
- Read-only, idempotent, public; no action is ever taken on anyone's behalf.
- No vendor-specific menu wording lives in code; it is page copy, dated, with the help links beside it.

## Owner setup
Nothing required: the endpoints work on every deploy. Optional, when wanted:
1. **Directory listings** (so people find Quad without this page): Claude at `claude.ai/directory/manage` (any paid
   plan; needs the privacy page, a docs page (`/connect`), a support contact, an icon); ChatGPT's plugin directory
   from the OpenAI Platform dashboard (identity verification, logo, privacy URL, test prompts). Both want the
   same MCP URL and the tool annotations already set.
2. **A custom domain** before publishing anywhere: the addresses on `/connect` follow the site's origin, so listings
   submitted from the `.vercel.app` address would break when the domain changes.
3. **Telemetry**: add `api_request` when request volume matters.

## Files
`lib/api/{public,mcp,http,openapi,skill,zip}.ts`, `app/api/mcp/route.ts`, `app/mcp/route.ts`,
`app/api/v1/{colleges,colleges/[unit_id],compare,glossary,openapi.json}/route.ts`, `app/connect/page.tsx`,
`app/connect/quad-skill.zip/route.ts`, `components/connect/ConnectAddresses.tsx`, `components/layout/Footer.tsx`
(link). Tests: `tests/mcp.test.mts`, `tests/api-v1.test.mts`.

## Open questions
1. OAuth and a `my_plan` tool set for signed-in families (the assistant reading your list and next steps) is a
   separate roadmap item once the next-steps work lands; the lazy-auth pattern (public tools open, sign-in on demand)
   is supported by Claude and ChatGPT.
2. Should Explore's `near`/`within` be exposed to assistants? It is (a ZIP, no account); a home address is never read.
