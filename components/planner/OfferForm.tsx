"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { ShareLetter } from "@/components/planner/ShareLetter";
import { Term } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import {
  COA_LABELS,
  COA_PARTS,
  GIFT_KINDS,
  GIFT_LABELS,
  LOAN_KINDS,
  LOAN_LABELS,
  awardYearLabel,
  cfpView,
  normalizeDraft,
  offerFlags,
  usd,
  type FallbackCoa,
  type OfferDraft,
} from "@/lib/planner/offers";
import { deleteOffer, saveOffer } from "@/lib/planner/store-offers";
import type { OfferGift, OfferLoan } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

type GiftRow = { kind: OfferGift["kind"]; name: string; amount: string; renewable: "yes" | "no" | "unknown"; renewal_condition: string; years: string };
type LoanRow = { kind: OfferLoan["kind"]; amount: string };

const input = "min-h-11 w-full rounded-xl border bg-background px-3 text-sm sm:min-h-10";
const money = (n: number | null | undefined) => (typeof n === "number" ? String(n) : "");

function fromDraft(d: OfferDraft | null) {
  return {
    coa: Object.fromEntries([...COA_PARTS, "total"].map((k) => [k, money(d?.coa[k as keyof OfferDraft["coa"]] as number | null)])) as Record<string, string>,
    stated: d?.coa.stated_by_college ?? true,
    gifts: (d?.gift ?? []).map<GiftRow>((g) => ({
      kind: g.kind,
      name: g.name,
      amount: String(g.amount),
      renewable: g.renewable === true ? "yes" : g.renewable === false ? "no" : "unknown",
      renewal_condition: g.renewal_condition ?? "",
      years: g.years ? String(g.years) : "",
    })),
    loans: (d?.loans ?? []).map<LoanRow>((l) => ({ kind: l.kind, amount: String(l.amount) })),
    workStudy: money(d?.work_study),
    letterDate: d?.letter_date ?? "",
  };
}

/**
 * One offer, typed from the letter in the federal College Financing Plan's layout on one screen (specs/planner/offers.md
 * "Letters", step 1): the cost of attendance by part, grants and scholarships by source with their renewal terms,
 * work-study, and loans by kind. The traps show inline as it's filled ("this sounds like a loan; move it?", "Parent
 * PLUS fills the gap", "no renewal terms"), with the net cost and out of pocket updating as they type. Saving confirms
 * every number (the family typed them), then asks the one question about sharing the letter.
 */
export function OfferForm({
  itemId,
  unitId,
  collegeName,
  awardYear,
  initial,
  offerId,
  fallback,
  onClose,
}: {
  itemId: string;
  unitId: string;
  collegeName: string;
  awardYear: number;
  initial: OfferDraft | null;
  offerId: string | null;
  fallback: FallbackCoa | null;
  onClose?: () => void;
}) {
  const start = fromDraft(initial);
  const [year, setYear] = useState(initial?.award_year ?? awardYear);
  const [letterDate, setLetterDate] = useState(start.letterDate);
  const [coa, setCoa] = useState(start.coa);
  const [stated, setStated] = useState(start.stated);
  const [gifts, setGifts] = useState<GiftRow[]>(start.gifts.length ? start.gifts : [{ kind: "college_need", name: "", amount: "", renewable: "unknown", renewal_condition: "", years: "" }]);
  const [loans, setLoans] = useState<LoanRow[]>(start.loans);
  const [workStudy, setWorkStudy] = useState(start.workStudy);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const raw = {
    award_year: year,
    letter_date: letterDate || null,
    coa: { ...coa, stated_by_college: stated },
    gift: gifts.map((g) => ({ ...g, renewable: g.renewable === "yes" ? true : g.renewable === "no" ? false : null })),
    work_study: workStudy,
    loans,
  };
  const parsed = normalizeDraft(raw);
  const draft = parsed.ok ? parsed.draft : null;
  const view = draft ? cfpView(draft, fallback) : null;
  const flags = draft && view ? offerFlags(draft, view, collegeName) : [];
  const giftFlags = (i: number) => flags.filter((f) => f.gift !== undefined && draft?.gift[f.gift] && sameGift(draft.gift[f.gift], gifts[i]));

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await saveOffer(itemId, raw);
      if (!r.ok) return setMessage(r.message);
      if (!offerId) track("plan_offer_added", { unit_id: unitId });
      setSaved(true);
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      if (!offerId) return;
      const r = await deleteOffer(offerId);
      if (!r.ok) return setMessage(r.message);
      router.refresh();
      onClose?.();
    });

  if (saved) {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm font-semibold">
          Saved. {collegeName}&apos;s offer is in the comparison.
        </p>
        <ShareLetter itemId={itemId} kind="aid" collegeName={collegeName} onDone={onClose} />
      </div>
    );
  }

  const years = [awardYear - 1, awardYear, awardYear + 1];
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          Award year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={cn(input, "mt-1")}>
            {years.map((y) => (
              <option key={y} value={y}>
                {awardYearLabel(y)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Letter date <span className="font-normal text-muted-foreground">(optional)</span>
          <input type="date" value={letterDate} onChange={(e) => setLetterDate(e.target.value)} className={cn(input, "mt-1")} />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-semibold">
          <Term term="cost-of-attendance">Cost of attendance</Term>
        </legend>
        <p className="text-xs text-muted-foreground">
          Type the lines the letter lists. Leave them blank if it lists none
          {fallback?.amount ? `, and the site's full price (${usd(fallback.amount)}${fallback.year ? `, ${fallback.year}` : ""}) stands in, flagged` : ""}.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[...COA_PARTS, "total" as const].map((k) => (
            <label key={k} className="text-xs font-semibold">
              {k === "total" ? "Total, as the letter states it" : COA_LABELS[k]}
              <MoneyInput value={coa[k]} onChange={(v) => setCoa({ ...coa, [k]: v })} label={k === "total" ? "Total cost of attendance" : COA_LABELS[k]} />
            </label>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={stated} onChange={(e) => setStated(e.target.checked)} className="size-4" />
          The letter states these costs (not our own estimate)
        </label>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">
          <Term term="gift-aid">Grants and scholarships</Term>
        </legend>
        <p className="text-xs text-muted-foreground">Money you don&apos;t pay back, one line each, with whether it renews.</p>
        <ul className="space-y-3">
          {gifts.map((g, i) => (
            <li key={i} className="space-y-2 rounded-2xl border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem]">
                <select aria-label="Source" value={g.kind} onChange={(e) => setGifts(gifts.map((x, j) => (j === i ? { ...x, kind: e.target.value as OfferGift["kind"] } : x)))} className={input}>
                  {GIFT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {GIFT_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input aria-label="Name on the letter" placeholder="Name on the letter" value={g.name} onChange={(e) => setGifts(gifts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={input} />
                <MoneyInput value={g.amount} onChange={(v) => setGifts(gifts.map((x, j) => (j === i ? { ...x, amount: v } : x)))} label="Amount for the year" />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">
                  <Term term="renewable-award">Renews</Term>?
                </span>
                {(["yes", "no", "unknown"] as const).map((v) => (
                  <label key={v} className="inline-flex min-h-11 items-center gap-1 sm:min-h-8">
                    <input type="radio" name={`renew-${i}`} checked={g.renewable === v} onChange={() => setGifts(gifts.map((x, j) => (j === i ? { ...x, renewable: v } : x)))} />
                    {v === "yes" ? "Yes" : v === "no" ? "First year only" : "Not stated"}
                  </label>
                ))}
                {g.renewable === "yes" && (
                  <input
                    aria-label="What keeps it"
                    placeholder="What keeps it (GPA, credits, aid forms)"
                    value={g.renewal_condition}
                    onChange={(e) => setGifts(gifts.map((x, j) => (j === i ? { ...x, renewal_condition: e.target.value } : x)))}
                    className={cn(input, "min-w-0 flex-1 sm:min-w-56")}
                  />
                )}
                <button type="button" aria-label="Remove this line" onClick={() => setGifts(gifts.filter((_, j) => j !== i))} className="ml-auto inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted sm:size-8">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <Traps flags={giftFlags(i)} />
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setGifts([...gifts, { kind: "college_need", name: "", amount: "", renewable: "unknown", renewal_condition: "", years: "" }])} className="inline-flex min-h-11 items-center gap-1 rounded-full border px-4 text-sm font-semibold hover:bg-muted sm:min-h-9">
          <Plus className="size-4" aria-hidden /> Add a grant or scholarship
        </button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">
          <Term term="work-study">Work-study</Term>
        </legend>
        <div className="max-w-48">
          <MoneyInput value={workStudy} onChange={setWorkStudy} label="Work-study for the year" />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">Loans</legend>
        <p className="text-xs text-muted-foreground">
          Every loan is repaid. <Term term="parent-plus">Parent PLUS</Term> and private loans aren&apos;t aid, so they stay out of the headline.
        </p>
        <ul className="space-y-2">
          {loans.map((l, i) => (
            <li key={i} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
              <select aria-label="Kind of loan" value={l.kind} onChange={(e) => setLoans(loans.map((x, j) => (j === i ? { ...x, kind: e.target.value as OfferLoan["kind"] } : x)))} className={input}>
                {LOAN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LOAN_LABELS[k]}
                  </option>
                ))}
              </select>
              <MoneyInput value={l.amount} onChange={(v) => setLoans(loans.map((x, j) => (j === i ? { ...x, amount: v } : x)))} label="Loan amount" />
              <button type="button" aria-label="Remove this loan" onClick={() => setLoans(loans.filter((_, j) => j !== i))} className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted sm:size-8">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setLoans([...loans, { kind: "direct_sub", amount: "" }])} className="inline-flex min-h-11 items-center gap-1 rounded-full border px-4 text-sm font-semibold hover:bg-muted sm:min-h-9">
          <Plus className="size-4" aria-hidden /> Add a loan
        </button>
      </fieldset>

      <section aria-live="polite" className="space-y-2 rounded-2xl bg-muted/40 p-3">
        {view ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Cost</dt>
              <dd className="font-semibold tabular-nums">{view.coa.total !== null ? usd(view.coa.total) : "Not stated"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Gift aid</dt>
              <dd className="font-semibold tabular-nums">{usd(view.gifts.total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                <Term term="net-cost">Net cost</Term>
              </dt>
              <dd className="font-semibold tabular-nums">{view.netCost !== null ? usd(view.netCost) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Out of pocket, if work-study is earned</dt>
              <dd className="font-semibold tabular-nums">{view.outOfPocket !== null ? usd(view.outOfPocket) : "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">The totals show as you type.</p>
        )}
        <Traps flags={flags.filter((f) => f.gift === undefined)} />
      </section>

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !draft} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {pending ? "Saving…" : "Save the offer"}
        </button>
        {offerId && (
          <button type="button" disabled={pending} onClick={remove} className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold text-muted-foreground hover:bg-muted">
            Delete this offer
          </button>
        )}
      </div>
    </form>
  );
}

function sameGift(a: OfferGift, b: GiftRow | undefined): boolean {
  return !!b && a.name === b.name.trim().slice(0, 120) && a.kind === b.kind;
}

function MoneyInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <span className="relative mt-1 block">
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <input inputMode="numeric" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(input, "pl-6 tabular-nums")} />
    </span>
  );
}

function Traps({ flags }: { flags: ReturnType<typeof offerFlags> }) {
  if (!flags.length) return null;
  return (
    <ul className="space-y-1">
      {flags.map((f, i) => (
        <li key={`${f.key}-${i}`} className={cn("flex items-start gap-1.5 text-xs", f.severity === "trap" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{f.line}</span>
        </li>
      ))}
    </ul>
  );
}
