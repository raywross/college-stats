/**
 * Sign-up, redesigned (specs/product/accounts.md "Sign-up", 2026-11-14): who you are decides what is asked; a birth
 * year only for a student; the high school and the home address ride in the user's metadata until /welcome applies
 * them; a parent's household is named after them; the welcome step sends a student straight to the card. Pure rules
 * plus file guards. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { householdNameFor, parseSignupMeta, signupNeedsBirthYear, WELCOME_PATH } from "../lib/accounts.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("only a student is asked for a birth year; parents and counselors are adults by their role", () => {
  assert.equal(signupNeedsBirthYear("student"), true);
  assert.equal(signupNeedsBirthYear("guardian"), false);
  assert.equal(signupNeedsBirthYear("counselor"), false);
});

test("parseSignupMeta keeps the high school and the address, trims, caps, and is null when nothing was given", () => {
  assert.deepEqual(parseSignupMeta({ high_school_id: " 123456 ", high_school_name: "Lincoln High", home_address: "30318" }), {
    highSchoolId: "123456",
    highSchoolName: "Lincoln High",
    homeAddress: "30318",
  });
  assert.deepEqual(parseSignupMeta({ home_address: "x".repeat(300) })!.homeAddress!.length, 200);
  assert.equal(parseSignupMeta({ high_school_id: "", home_address: "   " }), null);
  assert.equal(parseSignupMeta(null), null);
  assert.equal(parseSignupMeta("nope"), null);
});

test("a parent's household is named after them", () => {
  assert.equal(householdNameFor("Tracy Ross"), "The Ross household");
  assert.equal(householdNameFor("Tracy"), "Tracy's household");
  assert.equal(householdNameFor(null), "Our household");
  assert.equal(householdNameFor("  "), "Our household");
});

test("the form asks who you are first and only what that needs; the action reads the same fields and goes on to /welcome", () => {
  const form = read("app/login/LoginForm.tsx");
  assert.match(form, /ROLE_CARDS/);
  assert.match(form, /name="display_name"/, "full name for everyone");
  assert.match(form, /role === "student" && \(/, "a student's block");
  assert.match(form, /name="birth_year"/);
  assert.match(form, /HighSchoolPicker idName="high_school_id" nameName="high_school_name"/);
  assert.match(form, /role === "guardian" && \(/, "a parent's block");
  assert.match(form, /name="home_address"/);
  const action = read("app/login/actions.ts");
  assert.match(action, /signupNeedsBirthYear\(role\)/);
  assert.match(action, /display_name: name/);
  assert.match(action, /\$\{WELCOME_PATH\}\?next=/);
  assert.equal(WELCOME_PATH, "/welcome");
});

test("/welcome applies what sign-up collected, clears it, and sends a student to the card when the price is live", () => {
  const page = read("app/welcome/page.tsx");
  assert.match(page, /parseSignupMeta\(fresh\.user\?\.user_metadata\?\.signup\)/);
  assert.match(page, /create_household/);
  assert.match(page, /saveHomeAddress\(/);
  assert.match(page, /saveProfile\(student\.id/);
  assert.match(page, /billing\.needsCard/);
  assert.match(page, /createSubscriptionCheckout\(/);
  assert.match(page, /updateUser\(\{ data: \{ signup: null \} \}\)/, "applied once");
  assert.match(read("proxy.ts"), /"\/welcome"/, "the session is refreshed on the welcome step");
});

test("the birth-year nag on the account page is for students only", () => {
  assert.match(read("app/account/page.tsx"), /profile\.birth_year === null && profile\.role_hint === "student"/);
  assert.match(read("app/account/ProfileForm.tsx"), /required=\{profile\.birth_year === null && profile\.role_hint === "student"\}/);
});
