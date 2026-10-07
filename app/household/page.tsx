import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AddPersonDialog } from "@/components/account/AddPersonDialog";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { HomeForm } from "@/components/account/HomeForm";
import { Roster } from "@/components/account/Roster";
import { Term } from "@/components/ui/info-tip";
import { AccountsSetupError, authConfigured, currentStudent, getAccount, requireUser } from "@/lib/auth";
import { myHouseholds } from "@/lib/households";
import { myHome } from "@/lib/home-store";
import { HOUSEHOLD_MAX_MEMBERS, householdSeats, viewerRoles, type HouseholdView, type RosterMember } from "@/lib/household-rules";
import { defaultAddRole, defaultHouseholdName } from "@/lib/household-hub";
import type { Account, MemberRole } from "@/lib/accounts";

export const metadata: Metadata = { title: "Your household", robots: { index: false } };

const sectionCls = "rounded-3xl border bg-card p-4 sm:p-6";

/**
 * /household (specs/product/household-hub.md "The household page as the hub"): the roster (everyone by name, pending
 * invitations included), the home address, and Add someone. Someone without a household sees just themselves and
 * Add someone with a household-name field; adding the first person starts the household. An account is in one
 * household at a time (an account from before that rule still sees each of its households here).
 */
export default async function HouseholdPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/household");

  let account;
  try {
    account = await getAccount();
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (!account) return null;
  if (account.profile.deleted_at) redirect("/account");

  const [households, home, ownStudent] = await Promise.all([myHouseholds(), myHome(), currentStudent()]);
  // Address suggestions as you type exist only once the site has its Google key (home-and-distance.md "Autocomplete").
  const suggestions = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  // One household per account; an account from before that rule still sees each roster, and adds to the first.
  const first = households[0] ?? null;
  const hint = account.profile.role_hint;
  const soloRole: MemberRole = hint === "guardian" || hint === "counselor" ? "guardian" : ownStudent ? "student" : "guardian";
  const rosters = households.length > 0 ? households : [soloView(account, soloRole, ownStudent?.id ?? null)];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight break-words sm:text-4xl">
          {households.length === 1 ? households[0].name : <>Your <Term term="household">household</Term></>}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {first
            ? "Everyone here has a list of colleges; students have their numbers too. Guardians see their students' lists and numbers; students never see a guardian's finances."
            : "Start with the people who help with college: parents, guardians, and students. Use the + to add the first person."}
        </p>
      </header>

      <div className="space-y-6">
        {rosters.map((h, i) => (
          <People
            key={h.id || "solo"}
            h={h}
            titled={households.length > 1}
            add={
              i === 0 ? (
                <AddSomeone
                  household={first}
                  myRole={first ? (first.me.guardian ? "guardian" : "student") : soloRole}
                  defaultHouseholdName={defaultHouseholdName(account.profile.display_name)}
                />
              ) : null
            }
          />
        ))}
      </div>

      {first ? (
        <section id="home" className={`${sectionCls} scroll-mt-24`} aria-labelledby="home-title">
          <h2 id="home-title" className="font-display text-xl font-bold">
            <Term term="home-address">Home address</Term>
          </h2>
          <p className="mt-0.5 mb-3 text-sm text-muted-foreground">Explore and lists say how far each college is from here, for everyone in this household.</p>
          <HomeForm household={first.id} home={home && home.household_id === first.id ? home : null} suggestions={suggestions} />
        </section>
      ) : null}
    </div>
  );
}

/** The viewer alone, before they have a household: a roster of one, with no actions. */
function soloView(account: Account, role: MemberRole, ownStudentId: string | null): HouseholdView {
  const me: RosterMember = {
    member_id: null,
    role,
    user_id: account.user.id,
    student_id: role === "student" ? ownStudentId : null,
    display_name: account.profile.display_name,
    can_edit: false,
    managed: false,
    managed_by_me: false,
    is_me: true,
    joined: account.profile.created,
    status: "active",
    invitation_id: null,
    expires_at: null,
    grad_year: null,
    phone: null,
    email: null,
  };
  return { id: "", name: "", created: "", members: [me], me: viewerRoles([]) };
}

/** The People card: the roster, seats, and the "+" that opens Add someone (`add`, on the first card only). */
function People({ h, titled, add }: { h: HouseholdView; titled: boolean; add: React.ReactNode }) {
  const seats = householdSeats(h);
  return (
    <section id="add" className={`${sectionCls} scroll-mt-24`} aria-labelledby={`people-${h.id || "solo"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`people-${h.id || "solo"}`} className="font-display text-xl font-bold break-words">
            {titled ? h.name : "People"}
          </h2>
          {h.id && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {seats.taken} of {seats.max} seats{h.members.some((m) => m.status === "invited") ? ", counting invitations" : ""}
            </p>
          )}
        </div>
        {add}
      </div>
      <Roster h={h} />
    </section>
  );
}

/** The "+" button and its dialog, or the full-household note in its place. */
function AddSomeone({ household: h, myRole, defaultHouseholdName }: { household: HouseholdView | null; myRole: MemberRole; defaultHouseholdName: string }) {
  const seats = h ? householdSeats(h) : null;
  if (seats?.full)
    return (
      <p className="max-w-xs rounded-2xl bg-muted/60 px-3.5 py-2 text-xs text-muted-foreground" role="status">
        Full: {seats.max} people, counting invitations waiting for an answer. Cancel an invitation or remove someone to make room.
        {h?.members.some((m) => m.status === "managed" && m.managed_by_me) && " Inviting a student you added (Invite them, on their row) takes no new seat."}
      </p>
    );
  return (
    <AddPersonDialog
      description={
        h ? (
          <>
            They appear in the list right away, by name. Anyone with an email joins when they open their <Term term="household-invitation">link</Term>.
          </>
        ) : (
          <>
            Adding the first person starts your <Term term="household">household</Term>: up to {HOUSEHOLD_MAX_MEMBERS} people in any mix of parents and
            students, sharing one home address. If someone invited you, open the link they sent instead.
          </>
        )
      }
      household={h?.id ?? ""}
      myRole={myRole}
      canAddStudents={h ? h.me.guardian !== null : myRole === "guardian"}
      viewerIsStudent={h ? h.me.student !== null : myRole === "student"}
      defaultRole={defaultAddRole(h?.me ?? null, myRole)}
      defaultHouseholdName={defaultHouseholdName}
    />
  );
}
