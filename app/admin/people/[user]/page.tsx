import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { ConfirmTyped } from "@/components/admin/ConfirmTyped";
import { Empty, Fields, KeyValues, Muted, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { CONFIRM_DELETE, CONFIRM_REMOVE, deletingLabel, describeAuthActivity, fmtDate, fmtDateTime } from "@/lib/admin/console";
import { adminPerson, authActivity, logStudentView, type AdminMember, type AdminPerson } from "@/lib/admin/people";
import { personCollegeViews, VIEW_CHART_DAYS } from "@/lib/admin/college-views";
import { DailyViews, TopBars } from "@/components/admin/ViewCharts";
import { emailConfigured } from "@/lib/email";
import { isUuid } from "@/lib/household-hub";
import { removeMember } from "@/app/admin/households/[id]/actions";
import {
  changeEmail,
  copyResetLink,
  deactivate,
  deleteAccount,
  deleteNow,
  editProfile,
  reactivate,
  restoreAccount,
  sendResetEmail,
  setEmailConfirmed,
  signOutEverywhere,
} from "../actions";

export const metadata: Metadata = { title: "Person", robots: { index: false, follow: false } };

/**
 * /admin/people/[user] (specs/product/admin.md "A person"): the account, households, student records, lists and plan,
 * notifications, and who viewed their data, with every action in a right-hand column (below on phones). Everything on
 * this page is the person's own account information, not their student data: lists are counted here and opened on
 * the student page, which logs the view.
 */
export default async function PersonPage({ params }: PageProps<"/admin/people/[user]">) {
  await connection();
  const me = await requireAdmin();
  const { user } = await params;
  if (!isUuid(user)) notFound();
  const person = await adminPerson(user);
  if (!person) notFound();

  const { profile, auth } = person;
  const title = profile.display_name ?? auth?.email ?? "No name";
  const self = profile.id === me.userId;
  const deleted = profile.deleted_at !== null;
  const now = new Date();
  const [views, activity] = await Promise.all([personCollegeViews(profile.id), authActivity(profile.id)]);
  // Which colleges a student opens is their information: showing it is a view the student is told about, as on the
  // student page (specs/product/college-views.md).
  if (person.ownStudent && views.colleges.length > 0) await logStudentView(person.ownStudent.id, "college views");

  return (
    <>
      <PageHeader
        back={
          <Link href="/admin/people" className="text-muted-foreground underline-offset-4 hover:underline">
            People
          </Link>
        }
        title={title}
        chips={
          <span className="flex flex-wrap items-center gap-1.5">
            {self && <StatusChip label="You" tone="info" />}
            {person.isAdmin && <StatusChip label="Admin" tone="info" />}
            {profile.suspended_at && <StatusChip label="Paused" tone="warn" />}
            {person.purgeAt && <StatusChip label={deletingLabel(person.purgeAt, now)} tone="danger" />}
          </span>
        }
        subtitle={auth?.email ?? undefined}
      />
      <p className="mb-4 text-sm lg:hidden">
        <a href="#actions" className="font-semibold text-primary underline-offset-4 hover:underline">
          Jump to actions
        </a>
      </p>

      {deleted && person.purgeAt && (
        <div className="mb-5 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm" role="status">
          <p className="font-semibold">This account is scheduled for deletion.</p>
          <p className="mt-1 text-muted-foreground">
            Deleted {fmtDate(profile.deleted_at)}; it is removed for good on {fmtDate(person.purgeAt)} ({deletingLabel(person.purgeAt, now).toLowerCase()}). Restore it, or
            delete it now.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Panel title="Account" id="account">
            <Fields
              items={[
                { label: "Name", value: profile.display_name ?? <Muted>None</Muted> },
                { label: "Email", value: auth?.email ?? <Muted>None</Muted> },
                { label: "Email confirmed", value: auth?.email_confirmed_at ? fmtDate(auth.email_confirmed_at) : <Muted>Not confirmed</Muted> },
                { label: "Signs in with", value: auth?.providers.length ? auth.providers.join(", ") : <Muted>Unknown</Muted> },
                { label: "Created", value: fmtDateTime(auth?.created_at ?? profile.created) },
                { label: "Last sign-in", value: auth?.last_sign_in_at ? fmtDateTime(auth.last_sign_in_at) : <Muted>Never</Muted> },
                { label: "Second factor", value: auth?.mfa_enrolled ? "Enrolled" : <Muted>Not enrolled</Muted> },
                { label: "Birth year", value: profile.birth_year ?? <Muted>Not given</Muted> },
                { label: "Role hint", value: profile.role_hint ?? <Muted>None</Muted> },
                { label: "Phone", value: profile.phone ?? <Muted>None</Muted> },
                {
                  label: "Paused",
                  value: profile.suspended_at ? (
                    <>
                      {fmtDateTime(profile.suspended_at)}
                      {profile.suspended_reason && <span className="block text-muted-foreground">{profile.suspended_reason}</span>}
                    </>
                  ) : (
                    <Muted>No</Muted>
                  ),
                },
                { label: "Deleted", value: profile.deleted_at ? `${fmtDate(profile.deleted_at)}, removed ${fmtDate(person.purgeAt)}` : <Muted>No</Muted> },
              ]}
            />
          </Panel>

          <Panel title="Sign-in activity" id="sign-in">
            {activity.length === 0 ? (
              <Empty>No sign-in activity recorded.</Empty>
            ) : (
              <ol className="space-y-2 text-sm">
                {activity.slice(0, 40).map((a, i) => {
                  const { label, detail } = describeAuthActivity(a);
                  return (
                    <li key={`${a.at}-${a.kind}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span className="min-w-0">
                        <span className={a.source === "support" ? "text-muted-foreground" : "font-medium"}>{label}</span>
                        {detail && <span className="text-muted-foreground"> · {detail}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmtDateTime(a.at)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              From Supabase&apos;s records: sessions, the account&apos;s own dates, and its sign-in log when that&apos;s turned on. Devices come from the
              browser; addresses aren&apos;t shown.
            </p>
          </Panel>

          <Panel title="Households" id="households">
            {person.memberships.length === 0 ? (
              <Empty>Not in a household.</Empty>
            ) : (
              <ul className="space-y-4">
                {person.memberships.map(({ member, household, others }) => (
                  <li key={member.id} className="space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          <Link href={`/admin/households/${household.id}`} className="underline-offset-4 hover:underline">
                            {household.name}
                          </Link>
                          {household.deleted_at && <StatusChip label="Closed" tone="neutral" className="ml-2 align-middle" />}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {member.role === "guardian" ? (member.can_edit ? "Parent or guardian, can edit" : "Parent or guardian, view only") : "Student"} · since {fmtDate(member.since)}
                          {member.status !== "active" && ` · ${member.status}`}
                        </p>
                      </div>
                      {!household.deleted_at && (
                        <ConfirmTyped
                          action={removeMember}
                          hidden={{ member: member.id }}
                          trigger="Leave"
                          submit="Remove from household"
                          expected={CONFIRM_REMOVE}
                          description="Removes them from this household. Their own lists and numbers stay with them. The household sees a note that Quad support removed them."
                        />
                      )}
                    </div>
                    {others.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        With{" "}
                        {others.map((o, i) => (
                          <span key={o.id}>
                            {i > 0 && ", "}
                            <MemberLink member={o} />
                          </span>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Student records" id="students">
            {!person.ownStudent && person.managedStudents.length === 0 ? (
              <Empty>No student records: not their own, and none they manage.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {person.ownStudent && <StudentLine s={person.ownStudent} note="Their own record" />}
                {person.managedStudents.map((s) => (
                  <StudentLine key={s.id} s={s} note="Managed, no account yet" />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Colleges viewed"
            id="views"
            aside={
              views.colleges.length > 0 ? (
                <Link href={`/admin/people/${profile.id}/views`} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  All {views.colleges.length}
                </Link>
              ) : undefined
            }
          >
            {views.colleges.length === 0 ? (
              <Empty>No college pages opened while signed in.</Empty>
            ) : (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  {views.total.toLocaleString("en-US")} {views.total === 1 ? "view" : "views"} of {views.colleges.length}{" "}
                  {views.colleges.length === 1 ? "college" : "colleges"} · last {fmtDateTime(views.colleges.reduce((a, c) => (c.lastViewed > a ? c.lastViewed : a), ""))}
                </p>
                <DailyViews days={views.days} label={`Last ${VIEW_CHART_DAYS} days`} />
                <TopBars
                  unit={["view", "views"]}
                  rows={views.colleges.slice(0, 8).map((c) => ({
                    key: c.unitId,
                    label: c.name,
                    sub: `Last ${fmtDateTime(c.lastViewed)}`,
                    value: c.views,
                    href: `/admin/people/${profile.id}/views?unit=${c.unitId}`,
                  }))}
                />
                {person.ownStudent && <p className="text-xs text-muted-foreground">Showing these is recorded in their &ldquo;Who viewed your information&rdquo; as Quad support.</p>}
              </div>
            )}
          </Panel>

          <Panel title="Lists and plan" id="lists">
            {person.lists.length === 0 ? (
              <Empty>No lists.</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {person.lists.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="min-w-0 break-words">
                      <span className="font-semibold">{l.name}</span> <Muted>{l.items} {l.items === 1 ? "college" : "colleges"}</Muted>
                    </span>
                    {l.student_id && (
                      <Link href={`/admin/students/${l.student_id}`} className="text-primary underline-offset-4 hover:underline">
                        Open on the student page
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Lists open on the student page, which records that Quad support looked.</p>
          </Panel>

          <Panel title="Notifications" id="notifications">
            <Notifications n={person.notifications} />
          </Panel>

          <Panel title="Who viewed their data" id="views">
            {person.accessLog.length === 0 ? (
              <Empty>{person.ownStudent ? "No one has opened their student record." : "They have no student record of their own."}</Empty>
            ) : (
              <ul className="divide-y text-sm">
                {person.accessLog.slice(0, 50).map((v, i) => (
                  <li key={`${v.at}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-1.5">
                    <span>
                      {v.by_admin ? "Quad support (an admin)" : (v.viewer_name ?? "Someone")}
                      {v.by_admin && <StatusChip label="Admin" tone="info" className="ml-2 align-middle" />}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(v.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside id="actions" className="min-w-0 scroll-mt-24">
          <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5 lg:sticky lg:top-(--header-h)">
            <h2 className="font-display text-lg font-bold tracking-tight">Actions</h2>
            {deleted ? (
              <DeletedActions userId={profile.id} email={auth?.email ?? null} />
            ) : (
              <LiveActions person={person} self={self} />
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function MemberLink({ member }: { member: AdminMember }) {
  const href = member.user_id ? `/admin/people/${member.user_id}` : member.student_id ? `/admin/students/${member.student_id}` : null;
  const label = member.name ?? "Unnamed";
  return href ? (
    <Link href={href} className="underline-offset-4 hover:underline">
      {label}
    </Link>
  ) : (
    <>{label}</>
  );
}

function StudentLine({ s, note }: { s: AdminPerson["managedStudents"][number]; note: string }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4">
      <span className="min-w-0 break-words">
        <Link href={`/admin/students/${s.id}`} className="font-semibold underline-offset-4 hover:underline">
          {s.display_name ?? "Unnamed"}
        </Link>{" "}
        <Muted>
          {s.grad_year ? `Class of ${s.grad_year} · ` : ""}
          {note}
        </Muted>
      </span>
      {s.deleted_at && <StatusChip label={`Deleted ${fmtDate(s.deleted_at)}`} tone="danger" />}
    </li>
  );
}

function Notifications({ n }: { n: AdminPerson["notifications"] }) {
  return (
    <div className="space-y-4">
      {n.prefs ? <KeyValues data={n.prefs} /> : <Empty>No notification settings saved: the defaults apply.</Empty>}
      <div>
        <h3 className="text-sm font-semibold">Digests sent</h3>
        {n.digests.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="mt-1 divide-y text-sm">
            {n.digests.slice(0, 8).map((d) => (
              <li key={d.published_at} className="flex flex-wrap justify-between gap-x-4 py-1">
                <span>
                  {d.change_count} {d.change_count === 1 ? "change" : "changes"} across {d.college_count} {d.college_count === 1 ? "college" : "colleges"}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{d.sent_at ? `Sent ${fmtDate(d.sent_at)}` : `Published ${fmtDate(d.published_at)}, not sent`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold">Text-message consent</h3>
        {n.smsConsents.length === 0 ? (
          <Empty>None given.</Empty>
        ) : (
          <ul className="mt-1 divide-y text-sm">
            {n.smsConsents.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-x-4 py-1">
                <span className="font-mono text-[13px]">{c.phone}</span>
                <span className="text-xs text-muted-foreground">
                  Agreed {fmtDate(c.consented_at)}
                  {c.revoked_at && ` · revoked ${fmtDate(c.revoked_at)}`}
                  {c.provider_opt_out_at && ` · opted out ${fmtDate(c.provider_opt_out_at)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DeletedActions({ userId, email }: { userId: string; email: string | null }) {
  return (
    <div className="space-y-3">
      <AdminForm action={restoreAccount} hidden={{ user: userId }} trigger="Restore account" tone="primary" />
      <ConfirmTyped
        action={deleteNow}
        hidden={{ user: userId }}
        trigger="Delete now"
        submit="Delete for good"
        expected={email ?? CONFIRM_DELETE}
        instruction={
          email ? (
            <>
              Type <span className="font-mono break-all">{email}</span> to confirm
            </>
          ) : undefined
        }
        description="Removes the account, their student record, and any household left empty, now instead of at the end of the 30 days. This can't be undone."
      />
    </div>
  );
}

function LiveActions({ person, self }: { person: AdminPerson; self: boolean }) {
  const { profile, auth } = person;
  const hidden = { user: profile.id };
  const paused = profile.suspended_at !== null;
  const canEmail = emailConfigured();
  return (
    <div className="space-y-3">
      <AdminForm
        action={editProfile}
        hidden={hidden}
        trigger="Edit details"
        submit="Save"
        fields={[
          { name: "display_name", label: "Name", defaultValue: profile.display_name ?? "", maxLength: 80, autoComplete: "off" },
          { name: "birth_year", label: "Birth year", type: "number", defaultValue: profile.birth_year?.toString() ?? "", hint: "Once given, it can be corrected but not cleared." },
          {
            name: "role_hint",
            label: "Role hint",
            type: "select",
            defaultValue: profile.role_hint ?? "",
            options: [
              { value: "", label: "None" },
              { value: "student", label: "Student" },
              { value: "guardian", label: "Parent or guardian" },
              { value: "counselor", label: "Counselor" },
            ],
          },
          { name: "phone", label: "Phone", type: "tel", defaultValue: profile.phone ?? "" },
        ]}
      />
      <AdminForm
        action={changeEmail}
        hidden={hidden}
        trigger="Change email"
        submit="Change email"
        description={
          <>
            Vouches for the new address: no confirmation email is sent, and they sign in with it from now on.
            {auth?.email && (
              <>
                {" "}
                Now: <span className="font-mono break-all">{auth.email}</span>.
              </>
            )}
          </>
        }
        fields={[
          { name: "email", label: "New email", type: "email", required: true, autoComplete: "off" },
          { name: "email_again", label: "New email again", type: "email", required: true, autoComplete: "off" },
          { name: "repoint", label: "Also move invitations still waiting at the old address", type: "checkbox" },
        ]}
      />
      {auth?.email &&
        (auth.email_confirmed_at ? (
          self ? null : (
            <AdminForm
              action={setEmailConfirmed}
              hidden={{ ...hidden, confirmed: "false" }}
              trigger="Mark email unconfirmed"
              submit="Mark unconfirmed"
              description="Signs them out everywhere. Their next sign-in asks them to confirm their email, and the sign-in page offers to send it again."
            />
          )
        ) : (
          <AdminForm
            action={setEmailConfirmed}
            hidden={{ ...hidden, confirmed: "true" }}
            trigger="Confirm email"
            tone="primary"
            description="Vouches for this address so they can sign in without the confirmation email."
          />
        ))}
      <AdminForm action={copyResetLink} hidden={hidden} trigger="Copy reset link" pendingLabel="Making the link…" />
      {canEmail ? (
        <AdminForm action={sendResetEmail} hidden={hidden} trigger="Send reset email" />
      ) : (
        <p className="text-xs text-muted-foreground">Send reset email appears once email sending is set up. Copy reset link works now.</p>
      )}
      <AdminForm action={signOutEverywhere} hidden={hidden} trigger="Sign out everywhere" />
      {self ? (
        <p className="text-xs text-muted-foreground">You can&apos;t deactivate or delete your own account here.</p>
      ) : paused ? (
        <AdminForm action={reactivate} hidden={hidden} trigger="Reactivate" tone="primary" />
      ) : (
        <AdminForm
          action={deactivate}
          hidden={hidden}
          trigger="Deactivate"
          submit="Deactivate account"
          tone="danger"
          description="Stops them signing in and ends their sessions. Their data stays, and their parents still see it. Reversible with Reactivate."
          fields={[{ name: "reason", label: "Why (goes in the log)", type: "textarea", required: true, maxLength: 500 }]}
        />
      )}
      <ConfirmTyped
        action={deleteAccount}
        hidden={hidden}
        trigger="Delete account"
        submit="Delete account"
        expected={CONFIRM_DELETE}
        description="The same 30-day delete they get from their own account page: managed students, households, and memberships follow the built rules, and they are signed out. Restorable for 30 days."
      />
      <form method="post" action={`/admin/people/${profile.id}/export`}>
        <button type="submit" className="inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
          Export their data
        </button>
      </form>
    </div>
  );
}
