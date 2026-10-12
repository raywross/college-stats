import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";

export const metadata: Metadata = { title: "Second factor", robots: { index: false, follow: false } };

/**
 * /admin/mfa: the step itself is rendered by app/admin/layout.tsx in place of any console page while the session is
 * aal1 (components/admin/MfaStep.tsx), so this page is reached only by an admin who has already passed it. It says
 * so, and where the factor lives.
 */
export default async function MfaPage() {
  await connection();
  await requireAdmin();
  return (
    <>
      <PageHeader title="Second factor" />
      <Panel title="Your session has passed the second factor">
        <p className="max-w-prose text-sm text-muted-foreground">
          The console asks for the 6-digit code from your authenticator app each time you sign in. To replace the app, remove the factor from your account in
          the Supabase dashboard (Authentication, Users), then open the console again and set up the new one.
        </p>
        <Link href="/admin" className="mt-4 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
          Back to the console
        </Link>
      </Panel>
    </>
  );
}
