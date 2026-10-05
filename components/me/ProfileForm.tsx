"use client";

import { useActionState, useState } from "react";
import { STATES } from "@/lib/states";
import { SETTING_GROUPS } from "@/lib/campus-profile";
import { SIZE_BUCKETS } from "@/lib/metrics";
import { MAJOR_FAMILY_CODES, MAJOR_FAMILIES, type MajorFamily } from "@/lib/majors";
import { GPA_SCALES, MAX_INTENDED_MAJORS, OUTSIDE_US, gpaDisplay, type GpaScale, type StudentProfileData } from "@/lib/student-profile";
import { saveStudentProfile, type ProfileSaveState } from "@/app/me/actions";
import { Term } from "@/components/ui/info-tip";
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

/** GPA plus its scale, with a live "about 3.7 unweighted (from 93/100)" readout (student-profile.md "GPA normalization"). */
function GpaField({ disabled, gpa, gpaScale }: { disabled?: boolean; gpa: number | null; gpaScale: GpaScale }) {
  const [value, setValue] = useState(gpa);
  const [scale, setScale] = useState(gpaScale);
  const display = gpaDisplay({ gpa: value, gpaScale: scale });
  return (
    <Field label={<Term term="unweighted-gpa">GPA</Term>} htmlFor="gpa" hint={display ?? "Entered on whatever scale your school uses."}>
      <div className="mt-1.5 flex gap-2">
        <input
          id="gpa"
          name="gpa"
          type="number"
          step="0.01"
          min={0}
          max={100}
          disabled={disabled}
          defaultValue={gpa ?? ""}
          onChange={(e) => setValue(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
          className={`${inputCls} min-w-0 flex-1`}
          placeholder="3.8"
        />
        <select
          name="gpaScale"
          disabled={disabled}
          defaultValue={gpaScale}
          onChange={(e) => setScale(e.currentTarget.value as GpaScale)}
          className={`${inputCls} w-auto max-w-32 min-w-0 shrink-0`}
          aria-label="GPA scale"
        >
          {GPA_SCALES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}

/**
 * The /me form (student-profile.md "Display"): grouped, each group collapsible, one Server Action that sanitizes
 * and saves whatever's filled in. `canEdit=false` (a view-only guardian) renders every field disabled.
 */
export function ProfileForm({ studentId, data, canEdit }: { studentId: string; data: StudentProfileData; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ProfileSaveState, FormData>(saveStudentProfile, { status: "idle" });
  const disabled = !canEdit || pending;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="student_id" value={studentId} />

      <Group title="Basics" defaultOpen>
        <Field label="Graduation year" htmlFor="gradYear">
          <input id="gradYear" name="gradYear" type="number" inputMode="numeric" min={2000} max={2035} disabled={disabled} defaultValue={data.basics.gradYear ?? ""} className={`${inputCls} mt-1.5`} placeholder="2027" />
        </Field>
        <Field label="State of residence" htmlFor="stateOfResidence">
          <select id="stateOfResidence" name="stateOfResidence" disabled={disabled} defaultValue={data.basics.stateOfResidence ?? ""} className={`${inputCls} mt-1.5`}>
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
          <HighSchoolPicker idName="highSchoolId" nameName="highSchool" defaultId={data.basics.highSchoolId} defaultName={data.basics.highSchool} disabled={disabled} />
        </Field>
      </Group>

      <Group title="Academics">
        <GpaField disabled={disabled} gpa={data.academics.gpa} gpaScale={data.academics.gpaScale} />
        <Field label="Weighted GPA (optional)" htmlFor="weightedGpa">
          <input id="weightedGpa" name="weightedGpa" type="number" step="0.01" min={0} max={6} disabled={disabled} defaultValue={data.academics.weightedGpa ?? ""} className={`${inputCls} mt-1.5`} placeholder="4.3" />
        </Field>
        <Field label="Class rank percentile (optional)" htmlFor="classRankPercentile" hint='"Top 10%" is 10.'>
          <input id="classRankPercentile" name="classRankPercentile" type="number" min={1} max={100} disabled={disabled} defaultValue={data.academics.classRankPercentile ?? ""} className={`${inputCls} mt-1.5`} placeholder="10" />
        </Field>
        <Field label="AP/IB/dual-enrollment courses (optional)" htmlFor="courseRigorCount">
          <input id="courseRigorCount" name="courseRigorCount" type="number" min={0} max={40} disabled={disabled} defaultValue={data.academics.courseRigorCount ?? ""} className={`${inputCls} mt-1.5`} placeholder="6" />
        </Field>
      </Group>

      <Group title="Tests">
        <Field label="SAT total" htmlFor="satTotal">
          <input id="satTotal" name="satTotal" type="number" min={400} max={1600} disabled={disabled} defaultValue={data.tests.satTotal ?? ""} className={`${inputCls} mt-1.5`} placeholder="1450" />
        </Field>
        <Field label="ACT composite" htmlFor="actComposite">
          <input id="actComposite" name="actComposite" type="number" min={1} max={36} disabled={disabled} defaultValue={data.tests.actComposite ?? ""} className={`${inputCls} mt-1.5`} placeholder="32" />
        </Field>
        <Field label="SAT Reading & Writing (optional)" htmlFor="satReading">
          <input id="satReading" name="satReading" type="number" min={200} max={800} disabled={disabled} defaultValue={data.tests.satReading ?? ""} className={`${inputCls} mt-1.5`} />
        </Field>
        <Field label="SAT Math (optional)" htmlFor="satMath">
          <input id="satMath" name="satMath" type="number" min={200} max={800} disabled={disabled} defaultValue={data.tests.satMath ?? ""} className={`${inputCls} mt-1.5`} />
        </Field>
        <Field label="ACT English (optional)" htmlFor="actEnglish">
          <input id="actEnglish" name="actEnglish" type="number" min={1} max={36} disabled={disabled} defaultValue={data.tests.actEnglish ?? ""} className={`${inputCls} mt-1.5`} />
        </Field>
        <Field label="ACT Math (optional)" htmlFor="actMath">
          <input id="actMath" name="actMath" type="number" min={1} max={36} disabled={disabled} defaultValue={data.tests.actMath ?? ""} className={`${inputCls} mt-1.5`} />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="superscore" disabled={disabled} defaultChecked={data.tests.superscore} className="size-4" /> This is a{" "}
            <Term term="superscore">superscore</Term>
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="plansTestOptional" disabled={disabled} defaultChecked={data.tests.plansTestOptional} className="size-4" /> I plan to apply test-optional
          </label>
        </div>
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
        <Field label="States or regions (comma-separated, optional)" htmlFor="statesOrRegionsText" hint="USPS codes like TN, CA.">
          <input
            id="statesOrRegionsText"
            name="statesOrRegionsText"
            disabled={disabled}
            defaultValue={data.preferences.statesOrRegions.join(", ")}
            className={`${inputCls} mt-1.5`}
            placeholder="TN, CA, New England"
          />
        </Field>
        <Field label="Max average cost (optional)" htmlFor="maxAverageCost" hint="Compared against a college's average paid price, not sticker.">
          <input id="maxAverageCost" name="maxAverageCost" type="number" min={0} max={400000} step={1000} disabled={disabled} defaultValue={data.preferences.maxAverageCost ?? ""} className={`${inputCls} mt-1.5`} placeholder="30000" />
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
