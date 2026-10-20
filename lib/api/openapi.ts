/**
 * The OpenAPI 3.1 document for the public read endpoints under /api/v1 (specs/product/assistants.md). Built per
 * request so `servers` names the deployment it came from. Kept small: the four operations, their parameters, and
 * loose response schemas; the MCP server is the richer surface and shares these handlers.
 */
import { SECTION_TITLES, ATTRIBUTION } from "./public";

export function openApiDocument(origin: string): Record<string, unknown> {
  const source = {
    type: "object",
    properties: { label: { type: "string" }, publisher: { type: "string" }, year: { type: ["string", "null"] }, url: { type: "string" }, quote: { type: "string" } },
    required: ["label", "publisher", "year", "url"],
  };
  const summary = {
    type: "object",
    properties: {
      unit_id: { type: "string" },
      name: { type: "string" },
      city: { type: "string" },
      state: { type: "string" },
      type: { type: "string", enum: ["public", "private-nonprofit", "private-forprofit"] },
      url: { type: "string" },
      acceptance_rate: { type: ["number", "null"], description: "A share, 0 to 1." },
      undergrad_enrollment: { type: ["integer", "null"] },
      selectivity: { type: ["string", "null"], description: "Quad's selectivity tier in words." },
    },
    required: ["unit_id", "name", "city", "state", "type", "url"],
  };
  const fact = {
    type: "object",
    properties: { field: { type: "string" }, label: { type: "string" }, value: { type: "string" }, term: { type: "string" }, source },
    required: ["field", "label", "value", "term", "source"],
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Quad public college data",
      version: "1.0.0",
      description: `Read-only facts about about 1,900 four-year U.S. colleges, each value with its source and year. No key needed; about 60 requests a minute per address. ${ATTRIBUTION} Quad never provides admission odds for a person, and this API has no access to accounts or plans. The same data is available to assistants as an MCP server at ${origin}/mcp (see ${origin}/connect).`,
    },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/colleges": {
        get: {
          operationId: "listColleges",
          summary: "Find colleges by name, or explore by Quad's filters",
          description:
            "With q, the site's own name search (nicknames first). Without q, every Explore filter works: states, regions, types, sizes, minAR, maxAR, minSAT, maxSAT, minACT, maxACT, minCost, maxCost, policy, selectivity, setting, field, near and within, sortBy, sortDir, page. Lists are comma-separated; flags are 1.",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "A name, nickname, or part of a name." },
            { name: "state", in: "query", schema: { type: "string", maxLength: 2 }, description: "With q: keep results to one state." },
            { name: "states", in: "query", schema: { type: "string" }, description: "Explore filter: comma-separated USPS codes." },
            { name: "maxAR", in: "query", schema: { type: "integer" }, description: "Explore filter: highest admit rate, percent." },
            { name: "minAR", in: "query", schema: { type: "integer" } },
            { name: "selectivity", in: "query", schema: { type: "string", enum: ["elite", "highly_selective", "very_selective", "selective", "accessible", "open"] } },
            { name: "sortBy", in: "query", schema: { type: "string" }, description: "applicants (default), name, acceptance_rate, enrollment, sat, avg_cost, net_price, earnings, grad_rate, and the others Explore offers." },
            { name: "sortDir", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          ],
          responses: {
            "200": {
              description: "Matches, or a page of the filtered set.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { total: { type: "integer" }, page: { type: "integer" }, pages: { type: "integer" }, items: { type: "array", items: summary } },
                    required: ["total", "page", "pages", "items"],
                  },
                },
              },
            },
            "429": { description: "Too many requests; see Retry-After." },
          },
        },
      },
      "/api/v1/colleges/{unit_id}": {
        get: {
          operationId: "getCollege",
          summary: "One college's facts, each with its source and year",
          parameters: [
            { name: "unit_id", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]{1,10}$" }, description: "The IPEDS unit id from listColleges." },
            { name: "sections", in: "query", schema: { type: "string" }, description: `Comma-separated subset of sections, by title (${SECTION_TITLES.join(", ")}) or topic key (admissions, students, academics, cost, outcomes).` },
          ],
          responses: {
            "200": {
              description: "The college, its links, and its facts by section.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      college: summary,
                      about: { type: "object", properties: { region: { type: "string" }, website: { type: ["string", "null"] }, admissions: { type: ["string", "null"] }, visit: { type: ["string", "null"] } } },
                      sections: { type: "array", items: { type: "object", properties: { title: { type: "string" }, facts: { type: "array", items: fact } } } },
                      attribution: { type: "string" },
                    },
                  },
                },
              },
            },
            "404": { description: "No college with that id." },
            "429": { description: "Too many requests; see Retry-After." },
          },
        },
      },
      "/api/v1/compare": {
        get: {
          operationId: "compareColleges",
          summary: "Quad's Compare table for two to four colleges",
          parameters: [{ name: "ids", in: "query", required: true, schema: { type: "string" }, description: "Two to four comma-separated unit ids." }],
          responses: {
            "200": {
              description: "One row per metric: each college's value and the year it describes.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      colleges: { type: "array", items: summary },
                      rows: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            group: { type: "string" },
                            label: { type: "string" },
                            term: { type: "string" },
                            source,
                            values: { type: "array", items: { type: "object", properties: { unit_id: { type: "string" }, value: { type: ["string", "null"] }, year: { type: ["string", "null"] } } } },
                          },
                        },
                      },
                      attribution: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": { description: "Fewer than two known ids." },
            "429": { description: "Too many requests; see Retry-After." },
          },
        },
      },
      "/api/v1/glossary": {
        get: {
          operationId: "getGlossary",
          summary: "What Quad's terms mean",
          parameters: [{ name: "term", in: "query", schema: { type: "string" }, description: "A key (acceptance-rate) or part of a term; omit for all." }],
          responses: {
            "200": {
              description: "Glossary entries.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      terms: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: { key: { type: "string" }, term: { type: "string" }, short: { type: "string" }, long: { type: "string" }, why: { type: "string" }, category: { type: "string" }, related: { type: "array", items: { type: "string" } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
