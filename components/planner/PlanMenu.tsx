"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Copy, Download, Menu, Printer } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { Term } from "@/components/ui/info-tip";
import { TextConsent } from "@/components/planner/TextConsent";
import { createCalendarToken, planIcsOnce, revokeCalendarToken, type ConsentView } from "@/lib/planner/store-timeline";

const row = "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60 sm:min-h-10";

/**
 * The Plan menu (specs/planner/timeline.md "Display"): subscribe in a calendar (a webcal:// link shown once, with the
 * sentence that it's titles only and that anyone with it sees them; stop it here), a one-time .ics download, print
 * the college view, and, for a student's plan, the texts switch. A bottom sheet on phones.
 */
export function PlanMenu({
  listId,
  hasLink,
  consent,
  studentId,
  studentName,
}: {
  listId: string;
  /** This person already has a live calendar link for the list (its address isn't kept, so it can't be shown again). */
  hasLink: boolean;
  consent: ConsentView | null;
  studentId: string | null;
  studentName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const subscribe = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await createCalendarToken(listId);
      if (!r.ok) return setMessage(r.message);
      setUrl(`webcal://${window.location.host}/api/plan/${r.token}.ics`);
      router.refresh();
    });

  const stop = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await revokeCalendarToken(listId);
      if (!r.ok) return setMessage(r.message);
      setUrl(null);
      setMessage("The calendar link is stopped. Calendars subscribed to it stop updating.");
      router.refresh();
    });

  const download = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await planIcsOnce(listId);
      if (!r.ok) return setMessage(r.message);
      const blob = new Blob([r.ics], { type: "text/calendar" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = r.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

  return (
    <SheetDialog
      open={open}
      onOpenChange={setOpen}
      title="Plan menu"
      trigger={{
        className: "inline-flex size-11 items-center justify-center rounded-full border hover:bg-muted sm:size-10 print:hidden",
        label: "Plan menu: calendar, print, texts",
        content: <Menu className="size-4" aria-hidden />,
      }}
    >
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="font-semibold">
            <Term term="calendar-feed">Subscribe in your calendar</Term>
          </h3>
          <p className="text-sm text-muted-foreground">
            Every dated step and visit, in Apple, Google, or Outlook calendars, kept up to date. Titles only (&ldquo;Michigan: apply (ED
            I)&rdquo;), no notes or numbers, but anyone with the link sees those titles.
          </p>
          {url ? (
            <div className="space-y-2">
              <p className="rounded-xl border bg-muted/40 p-2 font-mono text-xs break-all">{url}</p>
              <div className="flex flex-wrap gap-2">
                <a href={url} className={row}>
                  <CalendarPlus className="size-4" aria-hidden /> Open in my calendar
                </a>
                <button type="button" className={row} onClick={() => void navigator.clipboard?.writeText(url).then(() => setMessage("Copied."))}>
                  <Copy className="size-4" aria-hidden /> Copy the link
                </button>
              </div>
              <p className="text-xs text-muted-foreground">This is the only time the link is shown. Lost it? Make a new one; the old one stops.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={subscribe} className={row}>
                <CalendarPlus className="size-4" aria-hidden /> {hasLink ? "Make a new calendar link" : "Make a calendar link"}
              </button>
              {hasLink && (
                <button type="button" disabled={pending} onClick={stop} className={row}>
                  Stop the calendar link
                </button>
              )}
            </div>
          )}
          {hasLink && url && (
            <button type="button" disabled={pending} onClick={stop} className="text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline">
              Stop the calendar link
            </button>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold">Once, as a file</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={download} className={row}>
              <Download className="size-4" aria-hidden /> Download .ics
            </button>
            <button
              type="button"
              className={row}
              onClick={() => {
                setOpen(false);
                setTimeout(() => window.print(), 300);
              }}
            >
              <Printer className="size-4" aria-hidden /> Print by college
            </button>
          </div>
        </section>

        {consent && studentId && (
          <section className="space-y-2">
            <h3 className="font-semibold">Texts</h3>
            <TextConsent view={consent} target={{ kind: "student", studentId }} studentName={studentName} />
          </section>
        )}

        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </SheetDialog>
  );
}
