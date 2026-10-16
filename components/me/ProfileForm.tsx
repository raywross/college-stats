"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight, GraduationCap } from "lucide-react";
import { STATES } from "@/lib/states";
import { SETTING_GROUPS } from "@/lib/campus-profile";
import { SIZE_BUCKETS } from "@/lib/metrics";
import { MAJOR_FAMILY_CODES, MAJOR_FAMILIES, type MajorFamily } from "@/lib/majors";
import { MAX_INTENDED_MAJORS, OUTSIDE_US, type StudentProfileData } from "@/lib/student-profile";
import { planHref } from "@/lib/planner/plan-tabs";
import { guideHref } from "@/lib/planner/guides";
import { saveStudentProfile, type ProfileSaveState } from "@/app/me/actions";
import { HighSchoolPicker } from "@/components/high-schools/HighSchoolPicker";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60";

const SCHOOL_TYPES: { value: StudentProfileData["preferences"]["types"][number]; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "private-nonprofit", label: "Private, nonprofit" },
  { value: "private-forprofit", label: "Private, for-profit" },
];

function Field({ label, htmlFor, hint, children }: { label: React.ReactNode; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Group({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border bg-card open:bg-card" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-display text-base font-bold select-none sm:px-5 sm:py-4">
        {title}
        <span className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="grid gap-4 border-t px-4 py-4 sm:grid-cols-2 sm:px-5 sm:py-5">{children}</div>
    </details>
  );
}

function CheckboxGroup({
  name,
  options,
  defaultValues,
  disabled,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValues: string[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
        >
          <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} disabled={disabled} className="size-3.5" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/**
 * Grades, test scores, courses, class standing, and activities and awards moved to the planner's intake guide
 * (household-hub.md "Household cleanup (2026-10-12)", "Trim to only the things we don't have in planner";
 * specs/planner/redesign/intake.md): this form no longer collects them (app/me/actions.ts keeps whatever's already
 * saved on every submit, so removing the fields here never wipes them), so in their place is one link into the
 * plan's edit mode (`planHref({ person: studentId, setup: true })`, the same route the plan's own "Edit ✎" opens).
 */
function EditInThePlan({ studentId }: { studentId: string }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <GraduationCap className="size-4.5" aria-hidden />
        </span>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Grades, test scores, courses, and activities and awards are in the plan now.</span>{" "}
          Open it to add or change them.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {/* Plan v3 (specs/planner/v3/guides/ap-choices.md): the courses guide, reachable from here too, not only its own move. */}
        <Link href={guideHref("courses", { person: studentId, from: "numbers" })} className="text-sm font-semibold text-primary hover:underline">
          Choose next year&apos;s courses
        </Link>
        {/* Plan v3 (specs/planner/v3/guides/recommenders.md): the recommenders guide, reachable from here too. */}
        <Link href={guideHref("recommenders", { person: studentId, from: "numbers" })} className="text-sm font-semibold text-primary hover:underline">
          Pick your recommenders
        </Link>
        <Link
          href={planHref({ person: studentId, setup: true })}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Open in the plan
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/**
 * The /me form (student-profile.md "Display"): grouped, each group collapsible, one Server Action that sanitizes
 * and saves whatever's filled in. `canEdit=false` (a view-only guardian) renders every field disabled. No field
 * shows a sample value as its placeholder (student-profile.md "Changes (2026-10-06)"): empty stays visibly empty,
 * and a muted hint under a field gives its range instead.
 *
 * Trimmed 2026-10-12 to what the planner doesn't have (household-hub.md "Household cleanup"): state of residence,
 * high school, fee-waiver eligibility, first generation, intended majors, early-round interest, and the college
 * preferences. Grades/GPA, class standing, the valedictorian/salutatorian expectation, tests, courses, activities,
 * and awards are the planner intake's now (`EditInThePlan`, above); graduation year moved with them (it's the
 * intake's own first screen, "Class of").
 */
export function ProfileForm({
  studentId,
  data,
  canEdit,
}: {
  studentId: string;
  data: StudentProfileData;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ProfileSaveState, FormData>(saveStudentProfile, { status: "idle" });
  const disabled = !canEdit || pending;

  // Controlled only so a high school pick can fill it in (see HighSchoolPicker's onSelect below); the student can
  // still change it freely afterward, same as any other select.
  const [residenceState, setResidenceState] = useState(data.basics.stateOfResidence ?? "");
  const [residenceFromSchool, setResidenceFromSchool] = useState(false);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="student_id" value={studentId} />

      <EditInThePlan studentId={studentId} />

      <Group title="Basics" defaultOpen>
        <Field
          label="State of residence"
          htmlFor="stateOfResidence"
          hint={residenceFromSchool ? "Set from your high school; change it if you live elsewhere." : undefined}
        >
          <select
            id="stateOfResidence"
            name="stateOfResidence"
            disabled={disabled}
            value={residenceState}
            onChange={(e) => {
              setResidenceState(e.target.value);
              setResidenceFromSchool(false);
            }}
            className={`${inputCls} mt-1.5`}
          >
            <option value="">Not set</option>
            <option value={OUTSIDE_US}>Outside the U.S.</option>
            {[...STATES.values()].map((s) => (
              <option key={s.postal} value={s.postal}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="High school" htmlFor="highSchool" hint="Pick it from the list so your school's data can show up on your college pages; not listed yet? Keep typing and it still saves.">
          <HighSchoolPicker
            idName="highSchoolId"
            nameName="highSchool"
            defaultId={data.basics.highSchoolId}
            defaultName={data.basics.highSchool}
            disabled={disabled}
            onSelect={(hit) => {
              // Only fills a blank state; a student who already set one (or typed over it) keeps their own answer.
              if (!residenceState && hit.state) {
                setResidenceState(hit.state);
                setResidenceFromSchool(true);
              }
            }}
          />
        </Field>
        <Field
          label="Fee-waiver eligible?"
          htmlFor="feeWaiverEligible"
          hint="The Common App/NACAC criteria (Pell-likely, first-generation, and others); asked once so the plan's fee line can say so."
        >
          <select id="feeWaiverEligible" name="feeWaiverEligible" disabled={disabled} defaultValue={data.basics.feeWaiverEligible === null ? "" : data.basics.feeWaiverEligible ? "yes" : "no"} className={`${inputCls} mt-1.5`}>
            <option value="">Not set</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <span className="block text-sm font-semibold">About you</span>
          <p className="mb-2 mt-0.5 text-xs text-muted-foreground">Optional; many colleges consider it.</p>
        </div>
        <Field label="First generation?" htmlFor="firstGeneration" hint="Neither of my parents finished a four-year degree.">
          <select
            id="firstGeneration"
            name="firstGeneration"
            disabled={disabled}
            defaultValue={data.academics.firstGeneration === null ? "" : data.academics.firstGeneration ? "yes" : "no"}
            className={`${inputCls} mt-1.5`}
          >
            <option value="">Not set</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
      </Group>

      <Group title="Plans">
        <div className="sm:col-span-2">
          <span className="block text-sm font-semibold">Intended majors (up to {MAX_INTENDED_MAJORS})</span>
          <div className="mt-1.5">
            <CheckboxGroup
              name="intendedMajors"
              disabled={disabled}
              defaultValues={data.plans.intendedMajors}
              options={MAJOR_FAMILY_CODES.map((code: MajorFamily) => ({ value: code, label: MAJOR_FAMILIES[code] }))}
            />
          </div>
        </div>
        <Field label="Early round interest" htmlFor="earlyRoundInterest">
          <select id="earlyRoundInterest" name="earlyRoundInterest" disabled={disabled} defaultValue={data.plans.earlyRoundInterest ?? ""} className={`${inputCls} mt-1.5`}>
            <option value="">Not set</option>
            <option value="ed">Early Decision</option>
            <option value="ea">Early Action</option>
            <option value="none">Regular only</option>
          </select>
        </Field>
      </Group>

      <Group title="Preferences">
        <div className="sm:col-span-2">
          <span className="block text-sm font-semibold">Size</span>
          <div className="mt-1.5">
            <CheckboxGroup name="sizes" disabled={disabled} defaultValues={data.preferences.sizes} options={SIZE_BUCKETS.map((b) => ({ value: b.key, label: `${b.label} (${b.hint})` }))} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <span className="block text-sm font-semibold">Setting</span>
          <div className="mt-1.5">
            <CheckboxGroup name="settings" disabled={disabled} defaultValues={data.preferences.settings} options={SETTING_GROUPS.map((g) => ({ value: g.key, label: g.label }))} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <span className="block text-sm font-semibold">Type</span>
          <div className="mt-1.5">
            <CheckboxGroup name="types" disabled={disabled} defaultValues={data.preferences.types} options={SCHOOL_TYPES} />
          </div>
        </div>
        <Field label="States or regions (comma-separated, optional)" htmlFor="statesOrRegionsText" hint="USPS codes (e.g. TN, CA) or region names, comma-separated.">
          <input
            id="statesOrRegionsText"
            name="statesOrRegionsText"
            disabled={disabled}
            defaultValue={data.preferences.statesOrRegions.join(", ")}
            className={`${inputCls} mt-1.5`}
          />
        </Field>
        <Field label="Max average cost (optional)" htmlFor="maxAverageCost" hint="Compared against a college's average paid price, not sticker; $0–400,000.">
          <input id="maxAverageCost" name="maxAverageCost" type="number" min={0} max={400000} step={1000} disabled={disabled} defaultValue={data.preferences.maxAverageCost ?? ""} className={`${inputCls} mt-1.5`} />
        </Field>
      </Group>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
          {state.status === "saved" && (
            <span className="text-sm font-medium text-muted-foreground" role="status">
              Saved.
            </span>
          )}
          {state.status === "error" && (
            <span className="text-sm font-medium text-destructive" role="alert">
              {state.message}
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You can view this profile, but only the student (or a guardian with edit access) can change it.</p>
      )}
    </form>
  );
}
