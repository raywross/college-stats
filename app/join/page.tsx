import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { typedJoinPath } from "@/lib/join-rules";

export const metadata: Metadata = { title: "Join a counselor", robots: { index: false } };

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base uppercase tracking-wide outline-none transition-colors placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * /join (specs/product/counselor-portal.md "How a student joins"): type the code a counselor gave you. A plain GET
 * form (works without scripts): `?code=` is read as typed ("QUAD-RIVERA", "rivera", or a pasted link) and opens
 * /join/<CODE>, which shows the organization; something that can't be a code says so here.
 */
export default async function JoinCodePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const typed = typeof code === "string" ? code : null;
  const path = typed ? typedJoinPath(typed) : null;
  if (path) redirect(path);

  return (
    <div className="mx-auto max-w-lg px-4 py-14 sm:py-20">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <KeyRound className="size-7" />
      </span>
      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight">Join your counselor</h1>
      <p className="mt-3 text-muted-foreground">
        Type the <Term term="join-code">code</Term> your counselor gave you, like QUAD-RIVERA. Next you see who it is before anything is shared.
      </p>
      <form action="/join" method="get" className="mt-6 space-y-3">
        <label htmlFor="join-code" className="block text-sm font-semibold">
          Code
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="join-code"
            name="code"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={200}
            defaultValue={typed ?? ""}
            placeholder="QUAD-RIVERA"
            aria-invalid={typed !== null || undefined}
            aria-describedby={typed !== null ? "join-code-error" : undefined}
            className={inputCls}
          />
          <button type="submit" className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground">
            Continue
          </button>
        </div>
        {typed !== null && (
          <p id="join-code-error" className="text-sm font-medium text-destructive" role="alert">
            That isn&apos;t a code. Codes are 4 to 6 letters, like QUAD-RIVERA.
          </p>
        )}
      </form>
    </div>
  );
}
