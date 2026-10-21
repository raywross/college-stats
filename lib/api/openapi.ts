/**
 * The OpenAPI 3.1 document for the Data API (specs/product/data-api.md, `/openapi.json`), generated from the route
 * table (lib/api/routes.ts) so it can't drift from the routes: one operation per row, `bearerAuth` on every keyed
 * one, the shared error shape, and the headers every response carries. Served at /api/v1/openapi.json without a key.
 *
 * Pure module, so tests build and check the document directly.
 */
import { API_KEY_LIMITS } from "./keys.ts";
import type { ApiParam, ApiRoute } from "./routes.ts";

/** An OpenAPI 3.1 document (loosely typed: the structure tests/api-v1.test.mts checks). */
export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown>; headers: Record<string, unknown> };
  security: Record<string, string[]>[];
}

const ERROR_RESPONSE = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

function parameter(p: ApiParam) {
  return {
    name: p.name,
    in: p.in,
    required: p.in === "path" ? true : (p.required ?? false),
    description: p.description,
    schema: { type: p.type, ...(p.enum ? { enum: [...p.enum] } : {}) },
  };
}

function operation(route: ApiRoute) {
  const headers = {
    "X-Dataset-Retrieved": { $ref: "#/components/headers/X-Dataset-Retrieved" },
    ETag: { $ref: "#/components/headers/ETag" },
  };
  const ok = {
    description: "OK",
    headers,
    content: { "application/json": { schema: { type: "object" }, ...(route.responseExample !== undefined ? { example: route.responseExample } : {}) } },
  };
  const responses: Record<string, unknown> = route.keyed
    ? {
        "200": ok,
        "304": { description: "Not modified: the If-None-Match you sent names the current ETag", headers },
        "400": ERROR_RESPONSE("bad_request: a parameter is invalid (the message names it)"),
        "401": ERROR_RESPONSE("missing_key or invalid_key: send a valid key as Authorization: Bearer quad_…"),
        "404": ERROR_RESPONSE("not_found"),
        "429": { ...ERROR_RESPONSE("rate_limited: over the day's or the minute's limit"), headers: { "Retry-After": { $ref: "#/components/headers/Retry-After" } } },
        "503": ERROR_RESPONSE("unavailable: the key check can't be reached right now"),
      }
    : { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } } };
  return {
    operationId: route.id.replace(/\.(\w)/g, (_, c: string) => c.toUpperCase()),
    summary: route.summary,
    description: route.description,
    parameters: route.params.map(parameter),
    // An operation without a key overrides the document-wide requirement with an empty list.
    security: route.keyed ? [{ bearerAuth: [] }] : [],
    responses,
  };
}

/** The document for `routes`, with `serverUrl` (the site's origin, e.g. "https://usequad.app") as its server. */
export function buildOpenApi(routes: readonly ApiRoute[], { serverUrl }: { serverUrl: string }): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};
  for (const route of routes) {
    paths[route.path] ??= {};
    paths[route.path][route.method.toLowerCase()] = operation(route);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Quad Data API",
      version: "1",
      description: [
        "The cleaned, cross-checked U.S. college dataset Quad's site shows, with per-field lineage (source, year, method).",
        "Every request but this document needs a key made on your account page (/account/api-keys), sent as Authorization: Bearer quad_….",
        `Limits per key: ${API_KEY_LIMITS.perDay.toLocaleString("en-US")} requests a day and ${API_KEY_LIMITS.perMinute} a minute.`,
        "Attribution: \"Data: Quad, from College Scorecard and IPEDS\" with the dataset's retrieved date (X-Dataset-Retrieved).",
      ].join(" "),
    },
    servers: [{ url: serverUrl.replace(/\/+$/, "") }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "quad_ followed by 40 lowercase base-32 characters", description: "An API key from /account/api-keys." },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
        },
      },
      headers: {
        "X-Dataset-Retrieved": { description: "When the dataset was retrieved from its sources (data/meta.json retrieved)", schema: { type: "string" } },
        ETag: { description: "Hash of the body; send it back as If-None-Match to get 304 when nothing changed", schema: { type: "string" } },
        "Retry-After": { description: "Seconds to wait before trying again", schema: { type: "integer" } },
      },
    },
    security: [{ bearerAuth: [] }],
  };
}
