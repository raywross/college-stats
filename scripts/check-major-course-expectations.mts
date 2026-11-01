/**
 * Checks the reference document major-course-expectations, the editorial "commonly expected" high school courses per
 * major family (specs/chances/course-plan.md "Data"): every family a real lib/majors.ts family listed once, every
 * expectation with text and a catalog course of its subject, every entry with at least one published https source.
 * Exits 1 with one line per problem.
 *
 *   npm run check:major-course-expectations
 */
import { MAJOR_EXPECTATIONS, validateExpectations } from "../lib/chances/major-course-expectations.ts";

const problems = validateExpectations(MAJOR_EXPECTATIONS);
if (problems.length > 0) {
  console.error(`the reference document major-course-expectations: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`the reference document major-course-expectations: ok (${MAJOR_EXPECTATIONS.families.length} families)`);
