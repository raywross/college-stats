/**
 * The downloadable Quad skill (specs/product/assistants.md): one SKILL.md in the Agent Skills format that Claude,
 * ChatGPT's workspace plans, and Gemini's Skills all upload, built per request so its links name the deployment.
 * It teaches an assistant how to reach Quad (the connector without a key, the keyed API with a person's own key, the
 * public pages otherwise) and how to speak about what Quad says: a source and year per number, never odds for a person.
 */
import { zipStore } from "./zip";
import { MCP_TOOL_NAMES } from "./mcp";
import { API_BASE, MCP_PATH, MCP_PUBLIC_PATH } from "./routes";
import { API_KEY_LIMITS } from "./keys";

export const SKILL_NAME = "quad";

export function skillMarkdown(origin: string): string {
  const tools = MCP_TOOL_NAMES.join(", ");
  return `---
name: ${SKILL_NAME}
description: Look up U.S. four-year colleges on Quad (${origin}): admissions, test ranges, cost, aid, outcomes, students, and year-by-year history for about 1,900 colleges, each value with its source and year. Use when someone asks about a college's numbers, wants colleges compared, or wants to find colleges by state, size, selectivity, cost, or admit rate.
license: Data as cited per value (College Scorecard, IPEDS, each college's Common Data Set); this skill text is public domain.
metadata:
  site: ${origin}
  mcp: ${origin}${MCP_PUBLIC_PATH}
  mcp_with_key: ${origin}${MCP_PATH}
  api: ${origin}${API_BASE}/openapi.json
---

# Quad

Quad is a college planning site. Its public data covers about 1,900 four-year U.S. colleges and is cleaned and
cross-checked from the federal files (College Scorecard, IPEDS) and each college's own Common Data Set, with a source
and year on every value. Quad also has a signed-in planner; this skill never touches it.

## How to reach Quad

1. **If the Quad connector is available** (an MCP server at \`${origin}${MCP_PUBLIC_PATH}\`, no key), use its tools: ${tools}.
   - \`search_colleges\` finds colleges by name, nickname, place, or Explore's filters (state, kind, size, admit rate,
     SAT and ACT ranges) and returns each one's \`unit_id\`.
   - \`get_college\` gives one college's full record (by \`unit_id\` or by name); \`get_lineage\` gives the source, year,
     and method behind each of its values; \`get_history\` gives its year-by-year series.
   - \`compare_colleges\` takes two to ten unit_ids and returns each metric with every college's value, its percentile
     rank, and the national median.
   - \`list_fields\` and \`get_dataset_info\` describe the dataset; \`glossary\` explains a term.
   - \`search\` and \`fetch\` are the same data in the shape ChatGPT's deep research uses.
2. **If the person has a Quad API key** (made on \`${origin}/account/api-keys\`), the same data is plain JSON over GET
   under \`${origin}${API_BASE}\` with \`Authorization: Bearer quad_…\` (${API_KEY_LIMITS.perDay.toLocaleString("en-US")} requests a day,
   ${API_KEY_LIMITS.perMinute} a minute), documented at \`${origin}${API_BASE}/openapi.json\`; the connector with the key is
   \`${origin}${MCP_PATH}\`. Never ask for a key to be pasted into a chat that others can read.
3. **Otherwise, read the public pages** (plain HTML with the same numbers and citations):
   - A college: \`${origin}/schools/{unit_id}\` (the unit_id is the college's IPEDS number; search the site's Explore page
     by name when you don't have it).
   - Explore: \`${origin}/explore?states=GA,NC&maxAR=40&sortBy=net_price\` (the same parameters as the API's \`/schools\`).
   - Compare: \`${origin}/compare?ids={id1},{id2}\`.
   - Glossary: \`${origin}/glossary\`.

## How to speak about what Quad says

- **Carry the citation.** Each number comes with a source and a year ("6.8% admitted, IPEDS, Fall of the year Quad
  names"). Repeat them; a number without its year misleads, since admissions change every cycle.
- **Link the college's Quad page** when you mention a college, so the person can see the full record.
- **Quad's selectivity tier is words, not a score** (Ultra selective, Highly selective, Very selective, Selective,
  Accessible, Open). Say the words; there is no number behind them to quote.
- **Never give odds.** Quad does not provide a person's chance of admission, and neither should you on its behalf.
  If asked, say that Quad's planner shows a signed-in student where they stand, and that this skill has no access to it.
- **Say what's missing.** A value Quad doesn't have is "not reported", not zero.
- **Cost means the figure named**: "average cost" is what students paid on average after aid; "sticker" is the published
  price; "net price by income" is for that income band. Don't mix them.
- **Credit the data** as "Data: Quad, from College Scorecard and IPEDS" with the retrieved date \`get_dataset_info\` gives.

## Don'ts

- Don't paraphrase a Common Data Set quote as Quad's opinion; it is the college's own words.
- Don't rank colleges by quality; Quad orders by facts (admit rate, size, cost), never by a composite.
- Don't submit forms, follow accounts, or take any action on anyone's behalf through Quad.
`;
}

/** The zip the assistants' uploaders expect: a folder named after the skill with SKILL.md inside. */
export function buildSkillZip(origin: string): Uint8Array {
  return zipStore([{ name: `${SKILL_NAME}/SKILL.md`, data: skillMarkdown(origin) }]);
}
