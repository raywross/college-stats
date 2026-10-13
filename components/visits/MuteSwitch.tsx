"use client";
/**
 * The per-college visit-alert mute (specs/product/visit-events.md "People's data", owner decision 2): a separate
 * switch from the hub's data-digest Updates switch. Used in VisitAlertSettings' muted-colleges list and on
 * /me/visits beside each followed college.
 */
import { useState, useTransition } from "react";
import { track } from "@/lib/analytics";
import { setVisitMute } from "@/lib/visit-events/store";

export function MuteSwitch({ unitId, schoolName, initiallyMuted, onChange }: { unitId: string; schoolName: string; initiallyMuted: boolean; onChange?: (muted: boolean) => void }) {
  const [muted, setMuted] = useState(initiallyMuted);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !muted;
    const before = muted;
    setMuted(next);
    startTransition(async () => {
      const result = await setVisitMute(unitId, next);
      if (!result.ok) {
        setMuted(before);
        return;
      }
      if (next) track("visit_alert_muted", { unit_id: unitId });
      onChange?.(next);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={muted}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-60"
    >
      {muted ? `Unmute ${schoolName}` : "Mute visit alerts"}
    </button>
  );
}
