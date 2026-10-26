import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountSection } from "@/components/account/AccountSection";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { KeysList } from "@/components/account/api-keys/KeysList";
import { MakeKeyForm } from "@/components/account/api-keys/MakeKeyForm";
import { ApiKeysSetupError, listMyApiKeys, type ApiKeyRow } from "@/lib/api-keys-store";
import { API_KEY_LIMITS } from "@/lib/api/keys";
import { AccountsSetupError, authConfigured, getAccount, requireUser } from "@/lib/auth";
import { requestOrigin } from "@/lib/household-hub";

export const metadata: Metadata = { title: "API keys", robots: { index: false } };

const link = "font-semibold text-primary hover:underline";

/**
 * /account/api-keys (specs/product/data-api.md "Pages"): the person's Data API keys, making one (shown once, with the
 * connection snippets), revoking one, and the limits. Before the api_keys migration is applied, the notice from the
 * store replaces the table and the form.
 */
export default async function ApiKeysPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/account/api-keys");

  try {
    const account = await getAccount();
    if (!account) return null;
    // An account scheduled for deletion sees only the way back, on /account.
    if (account.profile.deleted_at) redirect("/account");
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }

  let rows: ApiKeyRow[] = [];
  let notice: string | null = null;
  try {
    rows = await listMyApiKeys();
  } catch (err) {
    if (!(err instanceof ApiKeysSetupError)) throw err;
    notice = err.message;
  }
  const origin = requestOrigin(await headers());
  const active = rows.filter((k) => k.revoked_at === null).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <Link href="/account" className="text-sm font-semibold text-muted-foreground hover:text-foreground">
          ← Your account
        </Link>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">API keys</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          A key lets a script, a spreadsheet, Claude Code, Claude Desktop, or Cursor ask Quad for the same numbers the site shows, with the source
          and year of each. It is yours: it counts against your limits, and anything done with it is done as you. How to use one is on the{" "}
          <Link href="/developers" className={link}>
            developers page
          </Link>
          .
        </p>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Looking to add Quad to <b className="font-semibold text-foreground">ChatGPT</b>, <b className="font-semibold text-foreground">Gemini</b>,
          or Claude&apos;s connector menu? Those don&apos;t use a key — see{" "}
          <Link href="/connect" className={link}>
            Connect Quad to ChatGPT, Claude, and Gemini
          </Link>{" "}
          for the address and the steps.
        </p>
      </header>

      {notice ? (
        <p className="rounded-2xl border border-pop bg-pop/15 px-4 py-3 text-sm" role="status">
          {notice}
        </p>
      ) : (
        <>
          <AccountSection id="keys" title="Your keys" description="Only the start of each key is kept here. The key itself was shown once, when you made it.">
            <KeysList rows={rows} perDay={API_KEY_LIMITS.perDay} />
          </AccountSection>

          <AccountSection id="make" title="Make a key">
            <MakeKeyForm origin={origin} activeKeys={active} />
          </AccountSection>
        </>
      )}

      <AccountSection id="limits" title="Limits">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <b className="text-foreground">{API_KEY_LIMITS.perDay.toLocaleString("en-US")}</b> requests a day per key. The count starts over each day (UTC).
          </li>
          <li>
            <b className="text-foreground">{API_KEY_LIMITS.perMinute}</b> requests a minute per key.
          </li>
          <li>
            Up to <b className="text-foreground">{API_KEY_LIMITS.keysPerUser}</b> active keys per account. Revoked keys don&apos;t count.
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Over a limit, the API answers 429 and says when to try again.{" "}
          <Link href="/developers#authentication" className={link}>
            See the errors
          </Link>
        </p>
      </AccountSection>
    </div>
  );
}
