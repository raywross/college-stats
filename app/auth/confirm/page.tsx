import type { Metadata } from "next";
import { ConfirmSignIn } from "./ConfirmSignIn";

export const metadata: Metadata = { title: "Signing in", robots: { index: false } };

/** Where a magic link lands (specs/product/accounts.md, "Sign-in links"). */
export default function ConfirmPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="mb-4 font-display text-2xl font-extrabold tracking-tight">Signing in</h1>
      <ConfirmSignIn />
    </div>
  );
}
