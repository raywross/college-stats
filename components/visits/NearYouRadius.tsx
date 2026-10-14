"use client";
/**
 * The compact radius control atop /me/visits' "Near you" section (specs/product/visit-events.md "`/me/visits`"):
 * changes just the radius, without a trip to the full settings on /account. The measuring point itself (home vs.
 * high school) stays an /account setting.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/analytics";
import { RADIUS_OPTIONS, type RadiusMiles } from "@/lib/visit-events/types";
import { saveVisitPrefs } from "@/lib/visit-events/store";

export function NearYouRadius({ radiusMiles, pointLabel }: { radiusMiles: RadiusMiles; pointLabel: string | null }) {
  const router = useRouter();
  const [radius, setRadius] = useState<RadiusMiles>(radiusMiles);
  const [pending, startTransition] = useTransition();

  function change(next: RadiusMiles) {
    setRadius(next);
    startTransition(async () => {
      const result = await saveVisitPrefs({ radius_miles: next });
      if (result.ok) {
        track("visit_radius_changed", { miles: next });
        router.refresh();
      } else setRadius(radiusMiles);
    });
  }

  if (!pointLabel) return <p className="mt-1 text-xs text-muted-foreground">Add a home or high school to get a radius.</p>;

  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      Measuring
      <select
        value={radius}
        disabled={pending}
        onChange={(e) => change(Number(e.target.value) as RadiusMiles)}
        className="h-7 rounded-full border bg-card px-2 text-xs font-semibold text-foreground"
        aria-label="Alert radius"
      >
        {RADIUS_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m} miles
          </option>
        ))}
      </select>
      from {pointLabel}.
    </p>
  );
}
