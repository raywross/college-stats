/**
 * The downloadable Quad skill (specs/product/assistants.md): one SKILL.md in the Agent Skills format that Claude,
 * ChatGPT's workspace plans, and Gemini's Skills all upload, built per request so its links name the deployment.
 * It teaches an assistant how to use Quad (the MCP tools when connected, the public pages otherwise) and how to speak
 * about what Quad says: a source and year per number, never odds for a person.
 */
import { zipStore } from "./zip";
import { toolNames } from "./mcp";

export const SKILL_NAME = "quad";

export function skillMarkdown(origin: string): string {
  const tools = toolNames().join(", ");
  return `---
name: ${SKILL_NAME}
description: Look up U.S. four-year colleges on Quad (${origin}): admissions, test ranges, cost, aid, outcomes, and students for about 1,900 colleges, each value with its source and year. Use when someone asks about a college's numbers, wants colleges compared, or wants to find colleges by state, size, selectivity, cost, or admit rate.
license: Data as cited per value (College Scorecard, IPEDS, each college's Common Data Set); this skill text is public domain.
metadata:
  site: ${origin}
  mcp: ${origin}/mcp
  api: ${origin}/api/v1/openapi.json
---

# Quad

Quad is a college planning site. Its public data covers about 1,900 four-year U.S. colleges and is cleaned and
cross-checked from the federal files (College Scorecard, IPEDS) and each college's own Common Data Set, with a source
and year on every value. Quad also has a signed-in planner; this skill never touches it.

## How to reach Quad

1. **If the Quad connector is available** (an MCP server at \`${origin}/mcp\`), use its tools: ${tools}.
   - \`find_colleges\` turns a name or nickname into a \`unit_id\`.
   - \`college_facts\` gives one college's facts by section, each with \`source.label\` and \`source.year\`.
   - \`compare_colleges\` takes two to four unit_ids and returns Quad's Compare table.
   - \`explore_colleges\` filters all colleges with Quad's Explore parameters (states, regions, types, sizes, minAR/maxAR,
     minSAT/maxSAT, minACT/maxACT, minCost/maxCost, policy, selectivity, setting, field, near+within, sortBy, sortDir).
   - \`glossary\` explains a term.
2. **Otherwise, read the public pages** (they are plain HTML with the same numbers and citations):
   - A college: \`${origin}/schools/{unit_id}\`; find the id with \`${origin}/api/v1/colleges?q={name}\`.
   - Explore: \`${origin}/explore?states=GA,NC&maxAR=40&sortBy=net_price\` (the same parameters as the tool).
   - Compare: \`${origin}/compare?ids={id1},{id2}\`.
   - Glossary: \`${origin}/glossary\`.
   - The plain JSON endpoints are documented at \`${origin}/api/v1/openapi.json\`.

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
