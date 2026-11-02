import Link from "next/link";
import { SplashSection } from "@/components/advisor/Frame";
import { CASELOAD_HREF } from "@/lib/org-hrefs";

/** Counselors: the free line and the way into the portal, `/org` (specs/product/counselor-portal.md "The channel"). */
export function Counselors() {
  return (
    <SplashSection
      id="counselors"
      title="Counselors"
      line={
        <>
          Counselors and consultants use Quad free: see your students&apos; advisors, ask for what&apos;s missing, keep your notes.{" "}
          <Link href={CASELOAD_HREF} className="font-semibold text-primary hover:underline">
            Start your caseload
          </Link>
        </>
      }
    />
  );
}
