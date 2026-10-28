import { SplashSection } from "@/components/advisor/Frame";
import { COUNSELOR_CONTACT } from "@/components/advisor/links";
import { HELLO_EMAIL } from "@/lib/contacts";

/** Counselors: one line and a contact until the portal (specs/product/counselor-portal.md) is built. */
export function Counselors() {
  return (
    <SplashSection
      id="counselors"
      title="Counselors"
      line={
        <>
          Counselors and consultants will use Quad free, to see their students&apos; advisors and bring their school&apos;s data.{" "}
          <a href={COUNSELOR_CONTACT} className="font-semibold text-primary hover:underline">
            Write to {HELLO_EMAIL}
          </a>
        </>
      }
    />
  );
}
