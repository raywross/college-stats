/**
 * "Viewing as a guardian" banner (specs/product/accounts.md "Privacy model"). The real, shared version is
 * `components/account/GuardianBanner.tsx`, built by unit B (households); it isn't on this branch yet, so this is a
 * minimal stand-in with the same job. TODO(lead): once unit B's GuardianBanner lands, swap this import out in
 * app/me/page.tsx for `@/components/account/GuardianBanner` and delete this file.
 */
export function ViewingAsGuardianBanner({ studentName }: { studentName: string | null }) {
  return (
    <p className="rounded-2xl border border-dashed bg-muted/60 px-4 py-3 text-sm" role="status">
      Viewing as a guardian{studentName ? ` — ${studentName}'s profile` : ""}. Your reads here are logged and visible to the student.
    </p>
  );
}
