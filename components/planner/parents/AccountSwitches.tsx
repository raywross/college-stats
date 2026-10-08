import { refresh } from "next/cache";
import { AccountSection } from "@/components/account/AccountSection";
import { Term } from "@/components/ui/info-tip";
import { myNudgeEmails, myParentSummary, setNudgeEmails, setParentSummaryEmail } from "@/lib/planner/store-parents";

async function toggleParentSummary(on: boolean) {
  "use server";
  await setParentSummaryEmail(on);
  refresh();
}

async function toggleNudgeEmails(on: boolean) {
  "use server";
  await setNudgeEmails(on);
  refresh();
}

/**
 * The account-page switches for U8 (specs/planner/parents.md "The weekly summary", "Rules"): a guardian's weekly
 * parent-summary email (off by default), and anyone's "nudges by email" switch (on by default; in-app nudges show
 * regardless). `isGuardian`: this account is a guardian in at least one household (the weekly summary applies to
 * them); `hasStudent`: this account has its own student record (the nudge-emails switch applies to them).
 */
export async function AccountSwitches({ isGuardian, hasStudent }: { isGuardian: boolean; hasStudent: boolean }) {
  if (!isGuardian && !hasStudent) return null;
  const [summaryOn, nudgeEmailsOn] = await Promise.all([isGuardian ? myParentSummary() : Promise.resolve(false), hasStudent ? myNudgeEmails() : Promise.resolve(true)]);
  return (
    <AccountSection id="parent-summary" title="Parent summary and nudges" description="A weekly email for guardians, and how nudges reach you.">
      <div className="space-y-5">
        {isGuardian && (
          <div>
            <form action={toggleParentSummary.bind(null, !summaryOn)}>
              <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted sm:h-10">
                {summaryOn ? "Turn off the weekly summary" : "Turn on the weekly summary"}
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              The weekly summary is <strong>{summaryOn ? "on" : "off"}</strong>. One email on Sunday evening, per student you can see: the
              summary line, <Term term="your-part">Your part</Term>, the stuck signals, and what they ticked this week. No notes, no numbers,
              no comparison between students.
            </p>
          </div>
        )}
        {hasStudent && (
          <div>
            <form action={toggleNudgeEmails.bind(null, !nudgeEmailsOn)}>
              <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted sm:h-10">
                {nudgeEmailsOn ? "Turn off nudge emails" : "Turn on nudge emails"}
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              <Term term="nudge">Nudge</Term> emails are <strong>{nudgeEmailsOn ? "on" : "off"}</strong>. Turning them off doesn&apos;t hide a
              nudge in the plan; a guardian who nudges you sees that you read nudges there instead.
            </p>
          </div>
        )}
      </div>
    </AccountSection>
  );
}
