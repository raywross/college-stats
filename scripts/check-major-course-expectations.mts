/**
 * Checks data/reference/major-course-expectations.json, the editorial "commonly expected" high school courses per
 * major family (specs/chances/course-plan.md "Data"): every family a real lib/majors.ts family listed once, every
 * expectation with text and a catalog course of its subject, every entry with at least one published https source.
 * Exits 1 with one line per problem.
 *
 *   npm run check:major-course-expectations
 */
import { MAJOR_EXPECTATIONS, validateExpectations } from "../lib/chances/major-course-expectations.ts";

const problems = validateExpectations(MAJOR_EXPECTATIONS);
if (problems.length > 0) {
  console.error(`data/reference/major-course-expectations.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`data/reference/major-course-expectations.json: ok (${MAJOR_EXPECTATIONS.families.length} families)`);
