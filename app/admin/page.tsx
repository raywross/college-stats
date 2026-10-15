import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { LogRows } from "@/components/admin/LogRows";
import { PageHeader, Panel, Empty } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";
import { adminCounts } from "@/lib/admin/console-reads";
import { adminLog } from "@/lib/admin/people";
import { cardTone, loadVisitEventsHealth } from "@/lib/admin/visit-events";
import { VISIT_EVENTS_TONE_LABEL } from "@/components/admin/VisitEventsCard";

export const metadata: Metadata = { title: "Console", robots: { index: false, follow: false } };

/** /admin: a few counts and the latest log rows, with a way into each section (specs/product/admin.md "The console"). */
export default async function AdminHome() {
  await connection();
  await requireAdmin();
  const [counts, log, visitEvents] = await Promise.all([adminCounts(), adminLog(), loadVisitEventsHealth()]);
  const tiles: { label: string; value: number; href?: string; note?: string }[] = [
    { label: "People", value: counts.people, href: "/admin/people" },
    { label: "Households", value: counts.households },
    { label: "Students without an account", value: counts.managedStudents, note: "Made by a parent" },
    { label: "Invitations waiting", value: counts.pendingInvitations },
    { label: "Paused accounts", value: counts.paused },
    { label: "Being deleted", value: counts.deleting, note: "Inside the 30 days" },
    { label: "Admins", value: counts.admins, href: "/admin/admins" },
    { label: "Visit events, hosts read", value: visitEvents.newest?.hostsRead ?? 0, href: "/admin/health#visit-events", note: VISIT_EVENTS_TONE_LABEL[cardTone(visitEvents.newest, new Date())] },
  ];
  return (
    <>
      <PageHeader title="Console" subtitle="Everything here is logged, and a student whose data you open sees “Quad support viewed your information”." />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.label} className="rounded-2xl border bg-card p-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t.label}</p>
            <p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{t.href ? <Link href={t.href}>{t.value.toLocaleString("en-US")}</Link> : t.value.toLocaleString("en-US")}</p>
            {t.note && <p className="mt-0.5 text-xs text-muted-foreground">{t.note}</p>}
          </li>
        ))}
      </ul>
      <Panel
        title="Recent actions"
        className="mt-6"
        aside={
          <Link href="/admin/log" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
            Whole log
          </Link>
        }
      >
        {log.rows.length === 0 ? <Empty>Nothing has been logged yet.</Empty> : <LogRows rows={log.rows.slice(0, 8)} />}
      </Panel>
    </>
  );
}
