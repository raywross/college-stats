import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { myCounselorGrants } from "@/lib/orgs";

/**
 * The one line after joining a counselor (app/join/[code]/actions.ts lands on the advisor with `?joined=<grant id>`):
 * "Rivera Advising can see this advisor now." with where to change it. Nothing when the grant isn't the viewer's
 * family's (or is gone).
 */
export async function JoinedNotice({ grantId, ownStudentId }: { grantId: string; ownStudentId: string | null }) {
  const grant = (await myCounselorGrants().catch(() => [])).find((g) => g.grant_id === grantId);
  if (!grant) return null;
  const own = ownStudentId !== null && grant.student_id === ownStudentId;
  const settings = own ? "/account#counselors" : `/household/${encodeURIComponent(grant.student_id)}#counselors`;
  return <JoinedLine orgName={grant.org_name} settings={settings} />;
}

export function JoinedLine({ orgName, settings }: { orgName: string; settings: string }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold break-words">{orgName}</span> can see this advisor now.
      </span>
      <Link href={settings} className="font-semibold text-primary hover:underline">
        Change or end it
      </Link>
    </p>
  );
}
