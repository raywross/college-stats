"use client";

/**
 * The package page's body (specs/product/essays/workspace.md "Where it lives": "everything for one college, with
 * copy buttons per field and the download; a checklist beside it"): one card per prompt with its text, its limit,
 * the draft's current text (or "Not started yet"), and a copy button; the activities list at the end; the
 * checklist; the downloads. Records one `essay_package_opened` on mount.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Download } from "lucide-react";
import { track } from "@/lib/analytics";
import type { PackageActivity } from "@/lib/essays/docx";

const row = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted";
const CARD = "rounded-2xl border bg-card p-4 sm:p-5";

export interface PackageItemView {
  essayId: string | null;
  title: string;
  promptText: string | null;
  limitLine: string | null;
  body: string;
  started: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={row}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          track("essay_exported", { format: "copy" });
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      <Copy className="size-4" aria-hidden />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function Package({
  collegeName,
  unitId,
  items,
  activities,
  person,
}: {
  collegeName: string;
  unitId: string;
  items: PackageItemView[];
  activities: PackageActivity[];
  person: string | null;
}) {
  const anyStarted = items.some((i) => i.started);
  useEffect(() => {
    track("essay_package_opened", { started: anyStarted });
    // Only on mount: a toggle mid-visit isn't a new "open".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const q = person ? `?for=${person}` : "";

  return (
    <div className="space-y-6">
      <section className={`${CARD} space-y-2`}>
        <p className="font-semibold">Submission happens in {collegeName}&apos;s own application form, not here.</p>
        <p className="text-sm text-muted-foreground">Paste the main essay, answer the short questions in the form, and re-read each limit there — the form&apos;s is the one that counts.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={`/advisor/essays/package/${unitId}/export?format=docx${q}`} onClick={() => track("essay_exported", { format: "docx" })} className={row}>
            <Download className="size-4" aria-hidden />
            Download the package (.docx)
          </a>
          <a href={`/advisor/essays/package/${unitId}/export?format=txt${q}`} onClick={() => track("essay_exported", { format: "txt" })} className={row}>
            <Download className="size-4" aria-hidden />
            .txt
          </a>
        </div>
      </section>

      <ul className="space-y-4">
        {items.map((item, i) => (
          <li key={i} className={CARD}>
            <p className="font-display text-lg font-bold">{item.title}</p>
            {item.promptText && <p className="mt-1 max-w-prose">{item.promptText}</p>}
            {item.limitLine && <p className="mt-0.5 text-xs text-muted-foreground">{item.limitLine}</p>}
            {item.started ? (
              <>
                <p className="mt-3 max-w-prose whitespace-pre-wrap text-sm">{item.body}</p>
                <div className="mt-3">
                  <CopyButton text={item.body} />
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground italic">
                Not started yet.{" "}
                {item.essayId && (
                  <Link href={`/advisor/essays/${item.essayId}${q}`} className="font-semibold text-primary hover:underline not-italic">
                    Write it
                  </Link>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>

      {activities.length > 0 && (
        <section className={`${CARD} space-y-2`}>
          <p className="font-display text-lg font-bold">Activities</p>
          <ul className="space-y-1.5 text-sm">
            {activities.map((a, i) => (
              <li key={i}>
                <span className="font-semibold">{a.name}</span>
                {" — "}
                {[a.kindLabel, a.roleTitle, a.years.length ? `Grades ${a.years.join(", ")}` : null, a.hoursPerWeek ? `${a.hoursPerWeek} hrs/wk` : null].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${CARD} space-y-2`}>
        <p className="font-display text-lg font-bold">Checklist</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Paste the main essay</li>
          <li>Answer the short questions in the form</li>
          <li>Re-read the limit in the form</li>
        </ul>
      </section>
    </div>
  );
}

export default Package;
