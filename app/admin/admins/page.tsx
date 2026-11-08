import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ConfirmTyped } from "@/components/admin/ConfirmTyped";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { PersonPicker } from "@/components/admin/PersonPicker";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { CONFIRM_GRANT, CONFIRM_REVOKE, fmtDate } from "@/lib/admin/console";
import { findPeople } from "@/lib/admin/console-reads";
import { adminsList, type SearchRow } from "@/lib/admin/people";
import { grantAdmin, revokeAdmin } from "./actions";

export const metadata: Metadata = { title: "Admins", robots: { index: false, follow: false } };

/**
 * /admin/admins (specs/product/admin.md "Who is an admin"; specs/product/admin-redesign.md "Settings (More)"): who is
 * an admin, your own second factor (#second-factor, formerly /admin/mfa), grant by searching a person, revoke with
 * the rules. The first admin is added in the SQL Editor; every later one comes from here. You can't revoke yourself,
 * and the last admin can't be revoked: the buttons say so, and the database refuses either way.
 */
export default async function AdminsPage({ searchParams }: PageProps<"/admin/admins">) {
  await connection();
  const me = await requireAdmin();
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const granting = (Array.isArray(sp.grant) ? sp.grant[0] : sp.grant) === "1";

  const admins = await adminsList();
  const current = admins.filter((a) => a.revoked_at === null);
  const revoked = admins.filter((a) => a.revoked_at !== null);
  const currentIds = new Set(current.map((a) => a.user_id));
  const found: SearchRow[] | null = granting && q ? (await findPeople(q, ["user"])).filter((r) => !currentIds.has(r.id)) : null;

  return (
    <>
      <PageHeader title="Admins" help="admins" subtitle="Admins sign in with a second factor and can do everything in the console. Every action is logged." />
      <div className="space-y-5">
        <Panel title={`Admins (${current.length})`} id="admins" help="admins">
          <ul className="divide-y">
            {current.map((a) => {
              const isMe = a.user_id === me.userId;
              const last = current.length === 1;
              return (
                <li key={a.user_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <Link href={`/admin/people/${a.user_id}`} className="break-words underline-offset-4 hover:underline">
                        {a.name ?? a.email ?? "Unnamed"}
                      </Link>
                      {isMe && <StatusChip label="You" tone="info" />}
                    </p>
                    <p className="text-xs break-all text-muted-foreground">
                      {a.email && a.name ? `${a.email} · ` : ""}
                      Admin since {fmtDate(a.granted_at)}
                      {a.granted_by_name ? ` · made by ${a.granted_by_name}` : ""}
                    </p>
                    {a.note && <p className="text-xs text-muted-foreground">{a.note}</p>}
                  </div>
                  {isMe ? (
                    <p className="max-w-56 text-xs text-muted-foreground">You can&apos;t revoke yourself. Ask another admin.</p>
                  ) : last ? (
                    <p className="max-w-56 text-xs text-muted-foreground">The last admin can&apos;t be revoked.</p>
                  ) : (
                    <ConfirmTyped
                      action={revokeAdmin}
                      hidden={{ user: a.user_id }}
                      trigger="Revoke"
                      submit="Revoke admin"
                      expected={CONFIRM_REVOKE}
                      description={`${a.name ?? "They"} will no longer be able to open the console. This takes effect on their next page load.`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>

        {/* Was /admin/mfa (specs/product/admin-redesign.md "People"): the step itself is the layout's, at sign-in. */}
        <Panel title="Your second factor" id="second-factor" help="second-factor">
          <div className="max-w-prose space-y-2 text-sm text-muted-foreground">
            <p>Your session has passed the second factor. The console asks for the 6-digit code from your authenticator app each time you sign in.</p>
            <p>To replace the authenticator app:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>In the Supabase dashboard, open Authentication, then Users, and find your account.</li>
              <li>Remove its authenticator (Multi-factor) factor.</li>
              <li>Open the console again: it asks you to set up a new authenticator before anything else.</li>
            </ol>
          </div>
        </Panel>

        <Panel title="Make someone an admin" id="grant" help="admins">
          <PersonPicker
            action="/admin/admins"
            param="grant"
            mode="1"
            q={granting ? q : ""}
            label="Search a person by name, email, or id"
            rows={found}
            renderAction={(r) => (
              <ConfirmTyped
                action={grantAdmin}
                hidden={{ user: r.id }}
                trigger="Make admin"
                submit="Make admin"
                tone="primary"
                expected={CONFIRM_GRANT}
                description={`${r.name ?? "They"} will be able to read every family's information in the console. They set up an authenticator app the first time they open it.`}
                fields={[{ name: "note", label: "Note (optional, shown on this page)", maxLength: 200 }]}
              />
            )}
          />
        </Panel>

        {revoked.length > 0 && (
          <Panel title="Revoked" id="revoked" help="admins">
            <ul className="divide-y text-sm">
              {revoked.map((a) => (
                <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-x-4 py-2">
                  <Link href={`/admin/people/${a.user_id}`} className="underline-offset-4 hover:underline">
                    {a.name ?? a.email ?? "Unnamed"}
                  </Link>
                  <span className="text-xs text-muted-foreground">Revoked {fmtDate(a.revoked_at)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {current.length === 0 && <Empty>No admins.</Empty>}
      </div>
    </>
  );
}
