"use client";
/**
 * Visit-alert settings (specs/product/visit-events.md "Profile (/me)"): radius, measure from (with the point in use
 * named), include online sessions, the email switch, and the muted colleges. A separate switch from the hub's
 * data-digest Updates switch (owner decision 2). Rendered on /account beside the existing email choices.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/analytics";
import { RADIUS_OPTIONS, type MeasureFrom, type RadiusMiles, type VisitAlertPrefs } from "@/lib/visit-events/types";
import { saveVisitPrefs } from "@/lib/visit-events/store";
import { MuteSwitch } from "@/components/visits/MuteSwitch";

const MEASURE_LABEL: Record<MeasureFrom, string> = {
  auto: "Automatic (home, else your high school)",
  home: "Home",
  high_school: "High school",
};

export interface MutedCollege {
  unitId: string;
  name: string;
}

export function VisitAlertSettings({
  prefs,
  pointLabel,
  mutedColleges,
}: {
  prefs: VisitAlertPrefs;
  /** "home in Marietta, GA" or "Marietta High School"; null when neither is set. */
  pointLabel: string | null;
  mutedColleges: MutedCollege[];
}) {
  const router = useRouter();
  const [radius, setRadius] = useState<RadiusMiles>(prefs.radius_miles);
  const [measureFrom, setMeasureFrom] = useState<MeasureFrom>(prefs.measure_from);
  const [includeOnline, setIncludeOnline] = useState(prefs.include_online);
  const [emailOn, setEmailOn] = useState(prefs.email_visit_alerts);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    const changedRadius = radius !== prefs.radius_miles;
    startTransition(async () => {
      const result = await saveVisitPrefs({ radius_miles: radius, measure_from: measureFrom, include_online: includeOnline, email_visit_alerts: emailOn });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      if (changedRadius) track("visit_radius_changed", { miles: radius });
      setMessage("Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="visit-radius" className="text-xs font-semibold text-muted-foreground">
          Alert radius
        </label>
        <select
          id="visit-radius"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value) as RadiusMiles)}
          className="mt-1 h-10 w-full max-w-48 rounded-xl border border-input bg-background px-3 text-sm"
        >
          {RADIUS_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} miles
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="text-xs font-semibold text-muted-foreground">Measure from</legend>
        <div className="mt-1.5 space-y-1.5">
          {(Object.keys(MEASURE_LABEL) as MeasureFrom[]).map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input type="radio" name="visit-measure-from" value={opt} checked={measureFrom === opt} onChange={() => setMeasureFrom(opt)} />
              {MEASURE_LABEL[opt]}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {pointLabel ? `Measuring ${radius} miles from ${pointLabel}.` : "Add a home or high school to get alerts."}
        </p>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeOnline} onChange={(e) => setIncludeOnline(e.target.checked)} />
        Include online sessions in alerts
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
        Email me when a college on my list adds a visit
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          Save
        </button>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </div>

      {mutedColleges.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Muted colleges</p>
          <ul className="mt-1.5 space-y-1.5">
            {mutedColleges.map((c) => (
              <li key={c.unitId} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                <span className="truncate">{c.name}</span>
                <MuteSwitch unitId={c.unitId} schoolName={c.name} initiallyMuted onChange={() => router.refresh()} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
