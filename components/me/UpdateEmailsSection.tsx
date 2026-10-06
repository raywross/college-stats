import Link from "next/link";
import { refresh } from "next/cache";
import { AccountSection } from "@/components/account/AccountSection";
import { Term } from "@/components/ui/info-tip";
import { getEmailUpdates, setEmailUpdates } from "@/lib/notification-prefs";

/** A plain `<form action>` must return void, so this discards the result; the page re-renders with the new value. */
async function toggleEmailUpdates(enabled: boolean) {
  "use server";
  await setEmailUpdates(enabled);
  refresh();
}

/**
 * /account's "Update emails" section (specs/product/household-hub.md "What goes": the switch is per account, not
 * per list, so it moved here from the retired /me/following). Which colleges an email covers is each college's
 * Updates switch on the person's list; this turns the emails themselves on or off. The digest's one-click
 * unsubscribe link flips the same setting (app/unsubscribe/[token]/route.ts). Server component.
 */
export async function UpdateEmailsSection() {
  const emailUpdates = await getEmailUpdates();
  return (
    <AccountSection
      id="updates"
      title={<Term term="update-digest">Update emails</Term>}
      description="One email when colleges on your list change, at most once a day."
    >
      <form action={toggleEmailUpdates.bind(null, !emailUpdates)}>
        <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
          {emailUpdates ? "Turn off update emails" : "Turn on update emails"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
        Currently <strong>{emailUpdates ? "on" : "off"}</strong>. Each college&apos;s <Term term="updates">Updates</Term> switch on your list decides
        which ones you hear about; every email also has a one-click unsubscribe link. See past emails on{" "}
        <Link href="/me/updates" className="font-semibold text-primary hover:underline">
          your updates page
        </Link>
        .
      </p>
    </AccountSection>
  );
}
