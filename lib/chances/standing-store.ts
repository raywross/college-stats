"use server";
/**
 * The signed-in student's own numbers for the college profile's "Where you stand" (specs/chances/estimate.md "On the
 * profile"). The college pages are static (tests/accounts.test.mts forbids reading cookies while rendering a public
 * page), so the browser asks this Server Action after mount, then asks POST /api/estimate with what it returns. Only
 * what the estimate takes comes back, never the whole profile: the student as the contract describes them, the two
 * extras the server load also passes (the core-subject answers and the grade), and the student's entries as words for
 * the "What went into this estimate" panel. A guardian's view of a student is not this: it is the signed-in user's own.
 */
import { getUser } from "@/lib/auth";
import { myOwnProfile } from "@/lib/student-profile-store";
import { planGpaLabel } from "@/lib/student-profile";
import { gradeNow } from "./courses";
import type { EstimateContextInput } from "./estimate-request";
import { estimateInputFromProfile } from "./snapshot";
import type { EstimateStudent } from "./types";
import { hasNumbers, yourNumbersFrom, type YourNumbers } from "./what-went-in";

export type MyStanding =
  | { signedIn: false }
  | { signedIn: true; student: EstimateStudent; context: EstimateContextInput; yours: YourNumbers; hasNumbers: boolean };

export async function myStandingInput(): Promise<MyStanding> {
  const user = await getUser().catch(() => null);
  if (!user) return { signedIn: false };
  const profile = await myOwnProfile().catch(() => null);
  const { student } = estimateInputFromProfile(profile, "", null);
  return {
    signedIn: true,
    student,
    context: { coreAtTopLevel: profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(profile?.basics.gradYear ?? null, new Date().toISOString().slice(0, 10)) },
    yours: yourNumbersFrom(student, planGpaLabel(profile)),
    hasNumbers: hasNumbers(student),
  };
}
