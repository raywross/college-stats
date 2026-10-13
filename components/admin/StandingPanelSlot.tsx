import type { ReactNode } from "react";
import { standingForStudent } from "@/lib/admin/standing";
import { standingSummary, type StandingPanelView } from "@/lib/admin/hidden";

export interface StandingPanelSlotProps {
  /** The student record the page is about. */
  studentId: string;
  /** The college on the student's list (IPEDS unit id). */
  unitId: string;
  /** The list item, so the panel can name the list. */
  itemId: string;
}

/**
 * The standing panel (specs/product/admin.md "A student's standing"), collapsed by default under every college on
 * every list of the admin student page: the estimate's private detail for this student at this college, computed on
 * the server by estimateWithDetail() (lib/admin/standing.ts, once per page render for all slots). A Server Component
 * with no client code: the detail is rendered to HTML inside the page's requireAdmin() and never reaches a client
 * bundle or an API response. The student page has already logged the view.
 */
export async function StandingPanelSlot({ studentId, unitId, itemId }: StandingPanelSlotProps) {
  const standing = await standingForStudent(studentId);
  if (!standing.ok) {
    return <p className="text-xs text-muted-foreground">Standing unavailable: {standing.reason}</p>;
  }
  const view = standing.byItem.get(itemId);
  if (!view || view.unitId !== unitId) {
    return <p className="text-xs text-muted-foreground">No standing: this college isn&apos;t in the dataset.</p>;
  }
  return (
    <details className="rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs font-semibold">
        Standing <span className="font-normal text-muted-foreground">(admin only)</span>: {standingSummary(view)}
      </summary>
      <StandingBody view={view} />
    </details>
  );
}

function StandingBody({ view }: { view: StandingPanelView }) {
  return (
    <div className="mt-3 space-y-4">
      {view.fellBack && <p className="text-xs text-muted-foreground">The model failed for this college, so the estimate served the open baseline; there is no private detail.</p>}
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Item label="Level">{view.label ? `${view.level} · ${view.label}` : view.level}</Item>
        <Item label="Hidden odds">{view.hiddenOdds ?? "None (no level's measures)"}</Item>
        <Item label="Closeness">{view.closeness ?? "Not placed (no level, or a cap or floor set it)"}</Item>
        <Item label="Baseline's answer">{view.baseline ?? "None"}</Item>
        <Item label="Model version">
          <span className="font-mono text-[13px]">{view.modelVersion}</span>
        </Item>
        {view.detail.map((d) => (
          <Item key={d.label} label={d.label}>
            {d.value}
          </Item>
        ))}
      </dl>

      <div>
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Inputs</h4>
        <p className="mt-1">
          Used: {view.used.length ? view.used.join(", ") : "none"}
          {view.missing.length > 0 && <span className="text-muted-foreground"> · missing: {view.missing.join(", ")}</span>}
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-semibold">Input</th>
                <th className="py-1 pr-3 font-semibold">Student</th>
                <th className="py-1 font-semibold">College</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.sideBySide.map((r) => (
                <tr key={r.input}>
                  <td className="py-1 pr-3 font-medium">{r.input}</td>
                  <td className="py-1 pr-3">{r.student}</td>
                  <td className="py-1">{r.college}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {view.ablations.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Without each input</h4>
          <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
            {view.ablations.map((a) => (
              <li key={a.input} className="flex justify-between gap-3">
                <span>{a.input}</span>
                <span className={a.changed ? "font-semibold" : "text-muted-foreground"}>
                  {a.level}
                  {a.changed ? " (changes)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Notes that fired</h4>
        {view.notes.length ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {view.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">None.</p>
        )}
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}
