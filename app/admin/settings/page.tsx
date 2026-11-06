import type { Metadata } from "next";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDate } from "@/lib/admin/console";
import { adminSupabase } from "@/lib/admin/people";
import { ALL_MOVES_SETTING } from "@/lib/planner/all-moves-server";
import { isoDay, overrideAllowed, pretendTodayLine, TODAY_SETTING } from "@/lib/planner/today";
import { setAllMoves, setPretendToday } from "./actions";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

/**
 * /admin/settings (specs/product/admin.md "Settings"): switches for the whole site, stored in public.app_settings and
 * changed only through admin_set_setting(), which logs each change. Two so far: the planner's all-moves preview
 * (specs/planner/v3/all-moves-preview.md) and pretend today (specs/planner/v3/pretend-today.md).
 */
export default async function SettingsPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const { data, error } = await supabase.from("app_settings").select("value, updated_at").eq("key", ALL_MOVES_SETTING).maybeSingle();
  const on = data?.value === true;
  const todayRow = await supabase.from("app_settings").select("value, updated_at").eq("key", TODAY_SETTING).maybeSingle();
  const pretend = isoDay(todayRow.data?.value);
  const honored = overrideAllowed();

  return (
    <>
      <PageHeader title="Settings" subtitle="Switches for the whole site. Each change is logged." />
      <div className="space-y-5">
        <Panel title="Every next step, by season" id="all-moves" aside={<StatusChip label={on ? "On" : "Off"} tone={on ? "info" : "neutral"} />}>
          <div className="space-y-3 text-sm">
            <p className="max-w-3xl text-muted-foreground">
              For testing. On, every student&apos;s Next steps tab lists every move they could get, under the season it belongs to, and each one works
              (Done, Skip, its guide). Off, the tab shows the season&apos;s top three. While it&apos;s on, the &ldquo;Next:&rdquo; line, the calendar,
              and the emails see the extra moves too, so keep it off when real families are using the site.
            </p>
            {error && <p className="text-destructive">The settings table isn&apos;t there yet: apply migration 20261021120000_app_settings.sql.</p>}
            {data?.updated_at && <p className="text-xs text-muted-foreground">Last changed {fmtDate(data.updated_at)}</p>}
            {!error && (
              <AdminForm
                action={setAllMoves}
                hidden={{ on: on ? "0" : "1" }}
                trigger={on ? "Turn off" : "Turn on"}
                tone={on ? "default" : "primary"}
              />
            )}
          </div>
        </Panel>
        <Panel
          title="Pretend today is"
          id="pretend-today"
          aside={<StatusChip label={pretend ? (honored ? pretend : "Set, ignored here") : "Off"} tone={pretend && honored ? "info" : "neutral"} />}
        >
          <div className="space-y-3 text-sm">
            <p className="max-w-3xl text-muted-foreground">
              For testing the seasons. Set a day and every plan opens as if it were that day: the season, the moves, the grid&apos;s dates, the
              calendar, and the dates the plan stamps (applied on, decided on). A banner on every plan says so. Scheduled emails and the rest
              of the site keep the real date. Never honored in production.
            </p>
            {!honored && <p className="text-destructive">This is production: the setting is ignored here whatever it says.</p>}
            {pretend && <p className="font-medium">{pretendTodayLine(pretend)}</p>}
            {todayRow.data?.updated_at && <p className="text-xs text-muted-foreground">Last changed {fmtDate(todayRow.data.updated_at)}</p>}
            {!error && (
              <div className="flex flex-wrap gap-2">
                <AdminForm
                  action={setPretendToday}
                  trigger={pretend ? "Change the day" : "Set a day"}
                  submit="Use this day"
                  tone="primary"
                  fields={[{ name: "today", label: "Day", type: "date", defaultValue: pretend ?? "", required: true, hint: "YYYY-MM-DD, any year" }]}
                />
                {pretend && <AdminForm action={setPretendToday} hidden={{ today: "" }} trigger="Back to the real date" />}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
