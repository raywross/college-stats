"use client";

/**
 * The Show interest guide (specs/planner/v3/guides/show-interest.md "The page"): for one college (`?college=`), what
 * the college reports about applicant interest (CDS C7, cited), then the acts in the order the evidence supports:
 * **1 Visit** (its next events with Register, all its events, its visit page, "We already visited"), **2 Ask for
 * information** (its admissions page, "We already did" with the date), **3 Follow** (one button per account; a guardian
 * sees state only), and what the plan already records. Every outside link is an `ActButton`: the click is recorded as
 * pending and the page's `ReturnPrompt` asks about it when the tab comes back; a section with a pending act shows
 * "Pending: did you register …?" to the person who clicked, and to no one else.
 *
 * Without `?college=` (or a college that isn't on the list) it is the overview (InterestOverview). The header, the
 * move's why, and the footer's Done and Skip are GuideFrame's. Nothing here is a number from the estimate; the guide
 * never says a visit improves anything, only what the college reports and what colleges log.
 */
import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { WhyFold } from "@/components/ui/why-fold";
import { SOCIAL_GLYPHS } from "@/components/school/SocialIcons";
import { VisitForm } from "@/components/planner/VisitForm";
import { venueLine } from "@/components/visits/next-events-logic";
import { track } from "@/lib/analytics";
import { formatMiles } from "@/lib/home";
import type { AnyCited } from "@/lib/lineage";
import { followTargets, visitPageLink } from "@/lib/planner/capture";
import { INTEREST_FIELD } from "@/lib/planner/interest";
import { actForEvent, isVisitAct, type InterestAct, type InterestActRow } from "@/lib/planner/interest-acts";
import { interestSentence, interestVariant, loggedParts, type GuideEvent, type InterestGuideData } from "@/lib/planner/interest-guide";
import { markInfoRequested, recordFollow } from "@/lib/planner/store-actions";
import type { PlanItem, PlanSchool } from "@/lib/planner/types";
import type { SocialNetwork } from "@/lib/types";
import { dayLabel, timeLabel } from "@/lib/visit-events/view";
import { cn } from "@/lib/utils";
import { ActButton } from "./ActButton";
import { InterestOverview } from "./InterestOverview";
import { ReturnPrompt, useInterestActs } from "./ReturnPrompt";
import type { GuideProps } from "./types";

const BUTTON = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold disabled:opacity-60";
const PRIMARY = cn(BUTTON, "bg-foreground text-background hover:bg-foreground/90");
const SECONDARY = cn(BUTTON, "ring-1 ring-border hover:bg-muted");

export function InterestGuide(props: GuideProps) {
  const { ctx, query } = props;
  const item = query.college ? ctx.items.find((i) => i.unit_id === query.college && !i.withdrawn_on) : undefined;
  const school = item ? ctx.schools[item.unit_id] : undefined;
  if (!item || !school) return <InterestOverview {...props} notOnList={query.college !== null} />;
  const data = (props.data ?? null) as InterestGuideData | null;
  return (
    <ReturnPrompt key={item.id} initial={data?.pending ?? []} collegeName={school.name} zones={data?.zones ?? {}}>
      <CollegeGuide {...props} item={item} school={school} data={data} />
    </ReturnPrompt>
  );
}

export default InterestGuide;

interface CollegeProps extends Omit<GuideProps, "data"> {
  item: PlanItem;
  school: PlanSchool;
  data: InterestGuideData | null;
}

function CollegeGuide({ ctx, item, school, data }: CollegeProps) {
  const name = school.name;
  const factor = school.profile?.factors?.interest ?? null;
  const variant = interestVariant(factor);
  const muted = variant === "not_considered";
  const cited = school.cites[INTEREST_FIELD] as AnyCited | undefined;
  const edition = (school.cites[INTEREST_FIELD] as { cdsEdition?: string } | undefined)?.cdsEdition ?? null;
  const canEdit = ctx.viewer.canEdit;
  const canFollow = canEdit;
  const visits = ctx.visits.filter((v) => v.item_id === item.id);
  const logged = loggedParts(item, visits, ctx.today);
  const sentence = interestSentence(name, factor);

  return (
    <div className="min-w-0 space-y-5">
      <p className="max-w-prose">
        <MetricLabel cited={variant === "unknown" ? undefined : cited}>
          <span>
            <Term term="demonstrated-interest" cited={cited}>
              {sentence.claim}
            </Term>
            {variant !== "unknown" && edition ? ` (${edition}, CDS C7).` : "."}
          </span>
        </MetricLabel>
        {sentence.then && <span> {sentence.then}</span>}
      </p>

      <Section n={1} title="Visit" weight="counts most" muted={muted}>
        <VisitSection item={item} school={school} data={data} canEdit={canEdit} />
      </Section>

      <Section
        n={2}
        title="Ask for information"
        weight="counts"
        muted={muted}
        note={
          <WhyFold compact title="An information request or a mailing-list sign-up" screen="interest_guide" section="ask_for_information">
            An information request or a mailing-list sign-up puts you in {name}&apos;s system.
          </WhyFold>
        }
      >
        <InfoSection item={item} school={school} today={ctx.today} canEdit={canEdit} />
      </Section>

      <Section
        n={3}
        title="Follow"
        weight="weakest signal"
        muted={muted}
        note={
          <WhyFold compact title="Does following count?" screen="interest_guide" section="follow">
            No college says it counts a follow; do it for yourself.
          </WhyFold>
        }
      >
        <FollowSection item={item} school={school} canFollow={canFollow} />
      </Section>

      <p className="text-sm text-muted-foreground">
        {logged.length ? (
          <>
            <span className="font-semibold text-foreground">Logged for {name}:</span> {logged.join(" · ")}
          </>
        ) : (
          <>Nothing logged for {name} yet.</>
        )}
      </p>
    </div>
  );
}

function Section({
  n,
  title,
  weight,
  muted,
  note,
  children,
}: {
  n: number;
  title: string;
  weight: string;
  muted: boolean;
  /** A compact `WhyFold` info icon beside the title, for a section with a sentence to fold (less-text.md). */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5", muted && "bg-muted/40")} aria-labelledby={`interest-step-${n}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`interest-step-${n}`} className={cn("flex items-center gap-1.5 font-display text-lg font-bold", muted && "text-muted-foreground")}>
          <span className="mr-2 text-muted-foreground">{n}</span>
          {title}
          {note}
        </h2>
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{weight}</span>
      </div>
      <div className={cn("mt-3 space-y-3", muted && "opacity-80")}>{children}</div>
    </section>
  );
}

/** "Pending: did you register for …?  [Yes] [Not yet]" for the viewer's own pending acts of these kinds. */
function PendingLines({ kinds }: { kinds: (act: InterestAct) => boolean }) {
  const acts = useInterestActs();
  if (!acts) return null;
  const rows = acts.pending.filter((r) => kinds(r.act));
  if (!rows.length) return null;
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  return (
    <ul className="space-y-2">
      {rows.map((row: InterestActRow) => (
        <li key={row.id} className="flex flex-col gap-2 rounded-2xl border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="font-semibold">Pending:</span> {lower(acts.question(row))}
          </span>
          <span className="flex shrink-0 gap-2">
            <button type="button" disabled={acts.busy} onClick={() => acts.confirm(row, "manual")} className={PRIMARY}>
              Yes
            </button>
            <button type="button" disabled={acts.busy} onClick={() => acts.later(row)} className={SECONDARY}>
              Not yet
            </button>
          </span>
        </li>
      ))}
      {acts.error && (
        <li role="alert" className="text-sm text-destructive">
          {acts.error}
        </li>
      )}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* 1 Visit                                                              */
/* ------------------------------------------------------------------ */

function EventRow({ event, itemId, canEdit }: { event: GuideEvent; itemId: string; canEdit: boolean }) {
  const place = venueLine(event);
  return (
    <li className="flex flex-col gap-2 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-semibold break-words">
          {dayLabel(event)} · {event.all_day ? "All day" : timeLabel(event)} · {event.title}
        </p>
        {(place || event.distanceMiles != null) && (
          <p className="text-muted-foreground break-words">
            {place}
            {place && event.distanceMiles != null && " · "}
            {event.distanceMiles != null && formatMiles(event.distanceMiles)}
          </p>
        )}
      </div>
      <ActButton
        href={event.book_url}
        itemId={itemId}
        act={actForEvent(event.kind)}
        event={{ id: event.id, startsAt: event.starts_at, place, title: event.title }}
        track={canEdit}
        onRecorded={() => track("visit_signup_clicked", { unit_id: event.unit_id, kind: event.kind, near: event.near })}
        className={cn(PRIMARY, "shrink-0 self-start sm:self-center")}
        aria-label={`Register for ${event.title} (opens the college's page)`}
      >
        Register
      </ActButton>
    </li>
  );
}

function VisitSection({ item, school, data, canEdit }: { item: PlanItem; school: PlanSchool; data: InterestGuideData | null; canEdit: boolean }) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  const name = school.name;
  const events = data?.events ?? [];
  const page = visitPageLink(school.links ?? null);
  return (
    <>
      {events.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {name}&apos;s next events{data?.pointLabel ? ` near you (${data.pointLabel}) and on campus` : ""}
            {data?.readLine ? ` · ${data.readLine.charAt(0).toLowerCase()}${data.readLine.slice(1)}` : ""}
          </p>
          <ul className="space-y-2">
            {events.map((e) => (
              <EventRow key={e.id} event={e} itemId={item.id} canEdit={canEdit} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No upcoming events we can read from {name}&apos;s calendar.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {events.length > 0 && (
          <Link href={`/schools/${school.unit_id}?view=events`} className={SECONDARY}>
            All of {name}&apos;s events
          </Link>
        )}
        {page && page.label === "Campus visit page" && (
          <ActButton href={page.href} itemId={item.id} act="tour" track={canEdit} className={SECONDARY}>
            {name}&apos;s visit page
          </ActButton>
        )}
        {page && page.label === "Virtual tour" && (
          <a href={page.href} target="_blank" rel="noopener" className={SECONDARY}>
            <Term term="virtual-tour">{name}&apos;s virtual tour</Term>
          </a>
        )}
        {canEdit && (
          <button type="button" onClick={() => setLogging(true)} className={SECONDARY}>
            We already visited
          </button>
        )}
      </div>
      <PendingLines kinds={isVisitAct} />
      <SheetDialog open={logging} onOpenChange={setLogging} title={`Log a visit · ${name}`}>
        {logging && (
          <VisitForm
            itemId={item.id}
            householdNames={[]}
            onDone={() => {
              setLogging(false);
              track("plan_interest_act", { action: "visit" });
              router.refresh();
            }}
            onCancel={() => setLogging(false)}
          />
        )}
      </SheetDialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 2 Ask for information                                                */
/* ------------------------------------------------------------------ */

function InfoSection({ item, school, today, canEdit }: { item: PlanItem; school: PlanSchool; today: string; canEdit: boolean }) {
  const router = useRouter();
  const requestedOn = item.info_requested_on ?? null;
  const [value, setValue] = useState(requestedOn);
  const [seen, setSeen] = useState(requestedOn);
  if (seen !== requestedOn) {
    setSeen(requestedOn);
    setValue(requestedOn);
  }
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const name = school.name;
  const admissions = school.links?.admissions ?? null;

  const save = (next: string | null) => {
    if (!canEdit) return;
    const before = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await markInfoRequested(item.id, next !== null, next);
      if (!result.ok) {
        setValue(before);
        setError(result.message);
        return;
      }
      if (before === null && next !== null) track("plan_interest_act", { action: "request_info" });
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {admissions && (
          <ActButton href={admissions} itemId={item.id} act="info_request" track={canEdit} className={PRIMARY}>
            Request information
          </ActButton>
        )}
        {value === null ? (
          canEdit && (
            <button type="button" disabled={pending} onClick={() => save(today)} className={SECONDARY}>
              We already did
            </button>
          )
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2 text-sm">
            <Check className="size-4" aria-hidden />
            <span className="font-semibold">Requested</span>
            <input
              type="date"
              value={value}
              max={today}
              disabled={!canEdit || pending}
              onChange={(e) => e.target.value && e.target.value <= today && save(e.target.value)}
              aria-label={`When you requested information from ${name}`}
              className="h-11 rounded-full border bg-background px-3 text-base sm:text-sm"
            />
            {canEdit && (
              <button type="button" disabled={pending} onClick={() => save(null)} className={cn(BUTTON, "px-3 text-muted-foreground hover:bg-muted")}>
                Undo
              </button>
            )}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <PendingLines kinds={(a) => a === "info_request" || a === "mailing_list"} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 3 Follow                                                             */
/* ------------------------------------------------------------------ */

function FollowSection({ item, school, canFollow }: { item: PlanItem; school: PlanSchool; canFollow: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const social = school.social as Partial<Record<SocialNetwork, string>> | null | undefined;
  const targets = followTargets(social, (item.followed_networks ?? []) as SocialNetwork[]);
  const name = school.name;
  if (!targets.length) return <p className="text-sm text-muted-foreground">We don&apos;t have {name}&apos;s accounts on record.</p>;

  const unfollow = (network: SocialNetwork) => {
    setError(null);
    startTransition(async () => {
      const r = await recordFollow(item.id, network, false);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      router.refresh();
    });
  };

  const chip = "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {targets.map((t) => {
          const Glyph = SOCIAL_GLYPHS[t.network];
          if (t.followed) {
            return canFollow ? (
              <button
                key={t.network}
                type="button"
                role="checkbox"
                aria-checked
                disabled={pending}
                onClick={() => unfollow(t.network)}
                className={cn(chip, "border-foreground bg-foreground text-background disabled:opacity-60")}
                aria-label={`${t.label}: following (tap to undo)`}
              >
                <Glyph />
                {t.label}
                <Check className="size-3.5" aria-hidden />
              </button>
            ) : (
              <span key={t.network} className={cn(chip, "border-foreground bg-foreground text-background")} aria-label={`${t.label}: following`}>
                <Glyph />
                {t.label}
                <Check className="size-3.5" aria-hidden />
              </span>
            );
          }
          return canFollow ? (
            <ActButton key={t.network} href={t.href} itemId={item.id} act="follow" network={t.network} className={cn(chip, "bg-card hover:bg-muted")} aria-label={`Follow ${name} on ${t.label}`}>
              <Glyph />
              {t.label}
            </ActButton>
          ) : (
            <span key={t.network} className={cn(chip, "border-dashed text-muted-foreground")} aria-label={`${t.label}: not following`}>
              <Glyph />
              {t.label}
            </span>
          );
        })}
      </div>
      {!canFollow && <p className="text-xs text-muted-foreground">The student follows from their own account.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <PendingLines kinds={(a) => a === "follow"} />
    </>
  );
}
