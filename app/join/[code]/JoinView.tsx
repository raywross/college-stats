import Link from "next/link";
import type { ReactNode } from "react";
import { GraduationCap } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import type { JoinAsker, JoinState } from "@/lib/join-rules";
import { JoinForm } from "./JoinForm";

const outline = "inline-flex h-11 w-full items-center justify-center rounded-full border px-6 text-sm font-semibold hover:bg-muted sm:w-auto";
const primaryLink =
  "inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground sm:w-auto";

/**
 * The one-paragraph truth (specs/product/counselor-portal.md "How a student joins"): what the organization will see,
 * what it never sees, the log, and ending it. `whose` is "you" for the student and "student" for a parent choosing.
 * The word "access" carries the glossary's `counselor-access` entry (specs/glossary-and-tooltips.md).
 */
export function truthLine(orgName: string, whose: "you" | "student"): ReactNode {
  return whose === "you" ? (
    <>
      {orgName} will have <Term term="counselor-access">access</Term> to your record, your college list and advisor, and your essays. They never see your parents&apos; finances. You
      can see each time they look, and end it any time from your account.
    </>
  ) : (
    <>
      {orgName} will have <Term term="counselor-access">access</Term> to your student&apos;s record, college list and advisor, and essays. They never see your finances or your
      household. You and your student can see each time they look, and end it any time.
    </>
  );
}

/** What a counselor-side invitation means. */
export function counselorLine(orgName: string): string {
  return `You'll see the students on ${orgName}'s caseload: their records, lists, advisors, and essays, as each one allows. Counselors use Quad free.`;
}

/** "Not for you": the link is for students and their parents, with the organization's name. */
export function notForYouLine(orgName: string): string {
  return `This link is for students and their parents joining ${orgName}. Your account has no student to join with: sign in with a student's account, or a parent's who can see the student.`;
}

/**
 * /join/[code]'s body for one state (lib/join-rules.ts joinState): who is asking, the truth, and the one thing to do.
 * Plain markup and one client form, so tests render every state with react-dom/server.
 */
export function JoinView({ state, signedIn }: { state: JoinState; signedIn: boolean }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-14 sm:py-20">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <GraduationCap className="size-7" />
      </span>
      {state.kind === "not_found" ? (
        <>
          <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight">This link doesn&apos;t work</h1>
          <p className="mt-3 text-muted-foreground">{state.message}</p>
          <BackLinks signedIn={signedIn} retype />
        </>
      ) : (
        <>
          <Heading asker={state.asker} />
          <Body state={state} signedIn={signedIn} />
        </>
      )}
    </div>
  );
}

function Heading({ asker }: { asker: JoinAsker }) {
  return (
    <>
      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight break-words">
        Join {asker.orgName}
        {asker.side === "counselor" ? " as a counselor" : ""}
      </h1>
      {(asker.greet || asker.line) && (
        <p className="mt-2 font-semibold break-words">
          {asker.greet ? `Hi ${asker.greet}. ` : ""}
          {asker.source === "invite" ? (asker.line ? `${asker.line}.` : "") : asker.line ? `With ${asker.line}.` : ""}
        </p>
      )}
    </>
  );
}

function Body({ state, signedIn }: { state: Exclude<JoinState, { kind: "not_found" }>; signedIn: boolean }) {
  const { asker } = state;
  const truth = asker.side === "counselor" ? counselorLine(asker.orgName) : truthLine(asker.orgName, state.kind === "guardian" ? "student" : "you");
  switch (state.kind) {
    case "closed":
      return (
        <>
          <p className="mt-6 rounded-2xl bg-muted/60 px-4 py-3 text-sm font-medium" role="status">
            {state.message}
          </p>
          <BackLinks signedIn={signedIn} />
        </>
      );
    case "signed_out":
      return (
        <>
          <p className="mt-3 text-muted-foreground">{truth}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link href={state.signUpHref} className={primaryLink}>
              Create an account
            </Link>
            <Link href={state.signInHref} className={outline}>
              Sign in
            </Link>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Free. You come back here to join after signing in.</p>
        </>
      );
    case "student":
      return (
        <>
          <p className="mt-3 text-muted-foreground">{truth}</p>
          <div className="mt-6">
            <JoinForm segment={state.segment} label={`Join ${asker.orgName}`} />
          </div>
        </>
      );
    case "guardian":
      return (
        <>
          <p className="mt-3 text-muted-foreground">{truth}</p>
          <div className="mt-6">
            <JoinForm segment={state.segment} label="Join" students={state.students} />
          </div>
        </>
      );
    case "counselor_invite":
      return (
        <>
          <p className="mt-3 text-muted-foreground">{truth}</p>
          <div className="mt-6">
            <JoinForm segment={state.segment} label="Join as a counselor" side="counselor" />
          </div>
        </>
      );
    case "not_for_you":
      return (
        <>
          <p className="mt-6 rounded-2xl bg-muted/60 px-4 py-3 text-sm font-medium" role="status">
            {notForYouLine(asker.orgName)}
          </p>
          <BackLinks signedIn={signedIn} />
        </>
      );
  }
}

function BackLinks({ signedIn, retype = false }: { signedIn: boolean; retype?: boolean }) {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {retype && (
        <Link href="/join" className="rounded-full border px-5 py-2.5 text-sm font-semibold hover:bg-muted">
          Type a code
        </Link>
      )}
      <Link href={signedIn ? "/account" : "/"} className="rounded-full border px-5 py-2.5 text-sm font-semibold hover:bg-muted">
        {signedIn ? "Your account" : "Home"}
      </Link>
    </div>
  );
}
