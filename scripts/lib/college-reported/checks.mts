/**
 * The automated checks and the published-entry builder, as the pipeline imports them. lib/reported-checks.ts
 * (feature/college-reported-checks) provides `runChecks` and `toReportedEntry` with these signatures; until it is
 * merged, a local stand-in does. Swap this one import when it lands, then delete checks-stub.mts.
 */
export { runChecks, toReportedEntry } from "./checks-stub.mts";
