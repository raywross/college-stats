import { authConfigured, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { getData } from "@/lib/data";
import { icsCalendar } from "@/lib/ics";
import { VISIT_KIND_LABELS } from "@/lib/planner/actions";
import type { VisitKind } from "@/lib/planner/types";

/**
 * One visit's "Add to calendar" download (specs/planner/actions.md "Visits"): the college's name, its address, the
 * registration link, and a 24-hour alert. The caller's own session decides whether they may read it (`can_read_item`
 * on `plan_visits`, 20261008120000_planner.sql): a 404 for a visit they can't see keeps this from being a lookup
 * oracle. The event's own notes and rating never leave this file (actions.md "Rules": the file never carries them).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  if (!authConfigured()) return new Response("Not found", { status: 404 });
  const user = await getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const supabase = await createServerSupabase();
  const visit = await supabase
    .from("plan_visits")
    .select("id, item_id, kind, on_date, at_time, registration_url")
    .eq("id", visitId)
    .maybeSingle();
  if (visit.error || !visit.data) return new Response("Not found", { status: 404 });
  const v = visit.data as { id: string; item_id: string; kind: VisitKind; on_date: string; at_time: string | null; registration_url: string | null };

  const item = await supabase.from("list_items").select("unit_id").eq("id", v.item_id).maybeSingle();
  const unitId = (item.data as { unit_id: string } | null)?.unit_id ?? null;
  if (!unitId) return new Response("Not found", { status: 404 });

  const { getSchoolById } = await getData();
  const school = getSchoolById(unitId);
  if (!school) return new Response("Not found", { status: 404 });

  const location = [school.location.city, school.location.state, school.location.zip].filter(Boolean).join(", ");
  const kindLabel = VISIT_KIND_LABELS[v.kind] ?? "Visit";
  const calendar = icsCalendar(
    [
      {
        uid: `plan-visit-${v.id}@quad.app`,
        date: v.on_date,
        time: v.at_time ?? undefined,
        summary: `${school.name}: ${kindLabel}`,
        location,
        url: v.registration_url ?? undefined,
        description: v.registration_url ? `Registration: ${v.registration_url}` : undefined,
      },
    ],
    { name: `${school.name} visit` },
  );
  // A 24-hour alert, added as its own VALARM (icsCalendar covers the event; the alert is this route's own line).
  const withAlarm = calendar.replace(/END:VEVENT\r\n/, "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-P1D\r\nEND:VALARM\r\nEND:VEVENT\r\n");

  return new Response(withAlarm, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${school.name.replace(/[^\w -]/g, "")}-visit.ics"`,
    },
  });
}
