/**
 * Address suggestions as you type (lib/address-suggest.ts; the provider call in lib/geocode.ts is server-only and
 * is covered through its pure parser here). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SUGGEST_LIMIT,
  SUGGEST_MIN_CHARS,
  isSessionToken,
  normalizeAddressInput,
  parseGoogleAutocomplete,
  shouldSuggest,
} from "../lib/address-suggest.ts";

const ROOT = join(import.meta.dirname, "..");

/** The documented shape of Google's Place Autocomplete (New) answer. */
const GOOGLE = {
  suggestions: [
    {
      placePrediction: {
        place: "places/ChIJ",
        placeId: "ChIJ",
        text: { text: "77 Massachusetts Avenue, Cambridge, MA 02139, USA", matches: [{ endOffset: 5 }] },
        structuredFormat: { mainText: { text: "77 Massachusetts Avenue" }, secondaryText: { text: "Cambridge, MA 02139, USA" } },
        types: ["street_address"],
      },
    },
    { queryPrediction: { text: { text: "77 mass ave pizza" } } },
    { placePrediction: { text: { text: "   " } } },
    { placePrediction: { text: { text: "1 Main St, Springfield, IL, USA" } } },
  ],
};

test("parseGoogleAutocomplete keeps place predictions with their main and secondary lines, skips query predictions and blanks", () => {
  const out = parseGoogleAutocomplete(GOOGLE);
  assert.deepEqual(out, [
    { text: "77 Massachusetts Avenue, Cambridge, MA 02139, USA", main: "77 Massachusetts Avenue", secondary: "Cambridge, MA 02139, USA" },
    { text: "1 Main St, Springfield, IL, USA", main: "1 Main St, Springfield, IL, USA", secondary: "" },
  ]);
});

test("parseGoogleAutocomplete caps the list and survives junk", () => {
  const many = { suggestions: Array.from({ length: 12 }, (_, i) => ({ placePrediction: { text: { text: `${i} Elm St, Town, ST, USA` } } })) };
  assert.equal(parseGoogleAutocomplete(many).length, SUGGEST_LIMIT);
  assert.deepEqual(parseGoogleAutocomplete({}), []);
  assert.deepEqual(parseGoogleAutocomplete(null), []);
  assert.deepEqual(parseGoogleAutocomplete({ suggestions: "nope" }), []);
});

test("shouldSuggest waits for a few characters and refuses absurd lengths", () => {
  assert.equal(SUGGEST_MIN_CHARS, 3);
  assert.equal(shouldSuggest("12"), false);
  assert.equal(shouldSuggest("  12  "), false);
  assert.equal(shouldSuggest("123"), true);
  assert.equal(shouldSuggest("x".repeat(201)), false);
});

test("normalizeAddressInput collapses spaces and drops a trailing country from a picked suggestion", () => {
  assert.equal(normalizeAddressInput("  77 Massachusetts   Avenue, Cambridge, MA 02139, USA "), "77 Massachusetts Avenue, Cambridge, MA 02139");
  assert.equal(normalizeAddressInput("1 Main St, Springfield, IL, United States"), "1 Main St, Springfield, IL");
  assert.equal(normalizeAddressInput("1 Main St, Springfield, IL 62701"), "1 Main St, Springfield, IL 62701");
  assert.equal(normalizeAddressInput("USA Dr, Mobile, AL"), "USA Dr, Mobile, AL", "only a trailing country goes");
});

test("isSessionToken accepts a UUID-shaped token only", () => {
  assert.equal(isSessionToken("3b241101-e2bb-4255-8caf-4136c566a962"), true);
  assert.equal(isSessionToken("not-a-uuid"), false);
  assert.equal(isSessionToken(42), false);
});

test("guard: the field shows Google's logo beside Google's suggestions, and the key never leaves the server", () => {
  const field = readFileSync(join(ROOT, "components", "account", "AddressField.tsx"), "utf8");
  assert.match(field, /provider === "google"/, "the attribution is conditional on Google having answered");
  assert.match(field, /\/attribution\/google-light\.png/, "the required logo (light theme)");
  assert.match(field, /\/attribution\/google-dark\.png/, "the required logo (dark theme)");
  for (const f of ["google-light.png", "google-dark.png"]) assert.ok(existsSync(join(ROOT, "public", "attribution", f)), `${f} ships with the site`);
  assert.doesNotMatch(field, /GOOGLE_MAPS_API_KEY|NEXT_PUBLIC/, "the browser never sees the key");
  const geocode = readFileSync(join(ROOT, "lib", "geocode.ts"), "utf8");
  assert.match(geocode, /^import "server-only";/m, "the provider call stays server-side");
  assert.match(geocode, /process\.env\.GOOGLE_MAPS_API_KEY/, "the key is read from the server environment");
  const store = readFileSync(join(ROOT, "lib", "home-store.ts"), "utf8");
  assert.match(store, /export async function suggestAddresses[\s\S]*?getUser\(\)/, "suggestions require a signed-in user, so the quota isn't public");
});

test("guard: without the key the field is plain and the page says nothing about suggestions", () => {
  // The home address sits in Household settings, which the hub's layout renders on every /household page.
  const page = readFileSync(join(ROOT, "app", "household", "layout.tsx"), "utf8");
  assert.match(page, /const suggestions = Boolean\(process\.env\.GOOGLE_MAPS_API_KEY\)/, "the page decides from the server environment");
  assert.match(page, /suggestions=\{suggestions\}/, "and passes it down");
  const settings = readFileSync(join(ROOT, "components", "account", "HouseholdSettings.tsx"), "utf8");
  assert.match(settings, /<HomeForm [^>]*suggestions=\{suggestions\}/, "through Household settings to the form");
  const form = readFileSync(join(ROOT, "components", "account", "HomeForm.tsx"), "utf8");
  assert.match(form, /enabled=\{suggestions\}/, "the field only asks for suggestions when they're on");
  assert.match(form, /\{suggestions \? "Suggestions as you type come from Google/, "the Google sentence is conditional");
  const field = readFileSync(join(ROOT, "components", "account", "AddressField.tsx"), "utf8");
  assert.match(field, /if \(!enabled \|\| !shouldSuggest\(text\)\)/, "a disabled field never calls the server");
});
