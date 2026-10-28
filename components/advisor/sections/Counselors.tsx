import { SplashSection } from "@/components/advisor/Frame";
import { COUNSELOR_CONTACT } from "@/components/advisor/links";

/** Counselors: one line and a contact until the portal (specs/product/counselor-portal.md) is built. */
export function Counselors() {
  return (
    <SplashSection
      id="counselors"
      title="Counselors"
      line={
        <>
          Counselors and consultants will use Quad free, to see their students&apos; advisors and bring their school&apos;s data.{" "}
          <a href={COUNSELOR_CONTACT} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
            Get in touch
          </a>
        </>
      }
    />
  );
}
