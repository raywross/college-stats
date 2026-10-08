import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AddPersonDialog, HouseholdFullChip } from "@/components/account/AddPersonDialog";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { HouseholdSettings } from "@/components/account/HouseholdSettings";
import { PeopleStrip } from "@/components/account/PeopleStrip";
import { Term } from "@/components/ui/info-tip";
import { AccountsSetupError, authConfigured, currentStudent, getAccount, getUser } from "@/lib/auth";
import { myHouseholds } from "@/lib/households";
import { myHome } from "@/lib/home-store";
import { addPersonProps, soloRole as soloRoleFor } from "@/components/account/addPersonProps";
import { householdSeats, viewerRoles, type HouseholdView, type RosterMember } from "@/lib/household-rules";
import { defaultHouseholdName } from "@/lib/household-hub";
import { stageCaptions } from "@/lib/planner/hub";
import type { Account, MemberRole } from "@/lib/accounts";

/**
 * The household hub's one screen (specs/product/household-hub.md "Redesign (2026-10-06)"). Every /household page
 * renders inside this frame, top to bottom:
 *
 *   household name · "3 of 6 seats"
 *   people strip: [Alex · Class of 2028] [Tracy · You · Guardian] [Jordan · Invited] [+ Add]
 *   {children}: the selected person's area (name line, ⋯ menu, List | Numbers) and their list or numbers
 *   ▸ Household settings (collapsed): home address, Leave household
 *
 * Layouts persist across client navigation, so switching people swaps only `children`: no page transition and no
 * back link. Someone with no household yet sees a strip of just themselves and the "+" (the solo view); /household
 * itself redirects to a person (app/household/page.tsx). Signed out, it renders only `children`, whose own
 * requireUser() sends them to sign in with the exact page to come back to.
 */
export default async function HouseholdLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  if (!(await getUser())) return children;

  let account: Account | null;
  let households: HouseholdView[];
  let home: Awaited<ReturnType<typeof myHome>>;
  let ownStudentId: string | null;
  let captions: Record<string, string> = {};
  try {
    account = await getAccount();
    if (!account) return children;
    if (account.profile.deleted_at) redirect("/account");
    const [hs, h, own] = await Promise.all([myHouseholds(), myHome(), currentStudent()]);
    households = hs;
    home = h;
    ownStudentId = own?.id ?? null;
    // The plan's stage under each student in season (one query for all of them; empty on any error).
    const students = hs.flatMap((x) => x.members).filter((m) => m.role === "student" && m.student_id && m.member_id !== null);
    const forCaptions = students.map((m) => ({ id: m.student_id!, gradYear: m.grad_year }));
    if (hs.length === 0 && own) forCaptions.push({ id: own.id, gradYear: own.grad_year });
    captions = await stageCaptions(forCaptions);
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }

  // Address suggestions as you type exist only once the site has its Google key (home-and-distance.md "Autocomplete").
  const suggestions = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  // One household per account; an account from before that rule still sees each household's strip, and adds to the first.
  const first = households[0] ?? null;
  const soloRole = soloRoleFor(account.profile.role_hint, ownStudentId !== null);
  const strips = households.length > 0 ? households : [soloView(account, soloRole, ownStudentId)];
  const seats = first ? householdSeats(first) : null;
  const addChip = (
    <AddSomeone household={first} myRole={first ? (first.me.guardian ? "guardian" : "student") : soloRole} defaultHouseholdName={defaultHouseholdName(account.profile.display_name)} />
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12 print:px-0 print:py-0">
      <header className="space-y-4 print:hidden">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight break-words sm:text-3xl">
            {households.length === 1 ? households[0].name : households.length > 1 ? "Your households" : <>Your <Term term="household">household</Term></>}
          </h1>
          {seats && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {seats.taken} of {seats.max} seats{first?.members.some((m) => m.status === "invited") ? ", counting invitations" : ""}
            </p>
          )}
        </div>
        {strips.map((h, i) => (
          <div key={h.id || "solo"} className="space-y-1.5">
            {strips.length > 1 && <h2 className="text-sm font-semibold text-muted-foreground">{h.name}</h2>}
            <PeopleStrip
              householdId={h.id}
              members={h.members}
              add={i === 0 ? addChip : null}
              label={strips.length > 1 ? `People in ${h.name}` : undefined}
              captions={captions}
            />
          </div>
        ))}
      </header>

      <div className="mt-6 border-t pt-6 sm:mt-8 sm:pt-8 print:mt-0 print:border-0 print:pt-0">{children}</div>

      {first && (
        <HouseholdSettings
          household={first}
          home={home && home.household_id === first.id ? home : null}
          suggestions={suggestions}
          viewerIsStudent={first.me.student !== null}
        />
      )}
    </div>
  );
}

/** The viewer alone, before they have a household: a strip of one (their own chip, which opens their list). */
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

/** The strip's last chip: "+ Add", which opens Add someone, or "Full" with the reason when every seat is taken. */
function AddSomeone({ household: h, myRole, defaultHouseholdName }: { household: HouseholdView | null; myRole: MemberRole; defaultHouseholdName: string }) {
  const seats = h ? householdSeats(h) : null;
  if (seats?.full) return <HouseholdFullChip max={seats.max} canInviteManaged={h?.members.some((m) => m.status === "managed" && m.managed_by_me) ?? false} />;
  return <AddPersonDialog {...addPersonProps(h, myRole, defaultHouseholdName)} />;
}
