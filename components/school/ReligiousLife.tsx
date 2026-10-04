import Link from "next/link";
import { Church, HandCoins, Scale, UsersRound, Users } from "lucide-react";
import { getData } from "@/lib/data";
import { DOMAINS } from "@/lib/metrics";
import { IMPORTANCE_LABELS } from "@/lib/cds/admissions";
import { faithFamilyLabel, faithFilterOf, religionView } from "@/lib/religion";
import { groupListings, listingsFor } from "@/lib/directories";
import type { SchoolDetail } from "@/lib/detail";
import type { School } from "@/lib/types";
import { InfoTip } from "@/components/ui/info-tip";
import { BLOCK_SCROLL } from "@/components/profile/Panel";
import { CreditedList } from "./CreditedList";

/**
 * Campus life, "Religious life" (specs/religious-life.md): the IPEDS affiliation with NCES's exact label, what the
 * college's own Common Data Set says (C7 religious commitment in admission, H14 scholarships, F2 campus ministries;
 * phase 1), and "Faith communities" — traditions present with named groups and links from national directories,
 * credited per listing (phase 3). Neutral facts only; hidden when there's nothing in either part. Unmarked CDS boxes
 * show nothing. Shows at an unaffiliated college that has directory listings, replacing the generic
 * `<DirectoryListings domain="faith">` placeholder for this domain.
 */
export async function ReligiousLife({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const view = religionView(school);
  const groups = groupListings(listingsFor(detail?.tables.directories?.rows, "faith"));
  if (!view && !groups.length) return null;
  const { citeField } = await getData();
  const color = DOMAINS.size.color;
  const affiliation = view?.religion?.affiliation ?? null;
  const family = faithFilterOf(school);
  const aid = view?.aid ?? null;
  const aidKind = aid ? (aid.need && aid.non_need ? "need-based and non-need-based" : aid.need ? "need-based" : "non-need-based") : null;

  return (
    <div id="religion" className={`mt-4 rounded-3xl border bg-card p-4 sm:p-6 ${BLOCK_SCROLL}`}>
      <h3 className="mb-5 font-display text-lg font-bold">Religious life</h3>
      {view && (
      <div className="grid gap-6 sm:grid-cols-2">
        {view.religion && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Church className="size-4" style={{ color }} /> Affiliation <InfoTip term="religious-affiliation" cited={citeField("religion.affiliation", school)} />
            </p>
            <p className="mt-1 text-sm font-semibold">{affiliation ? affiliation.label : "No religious affiliation"}</p>
            {affiliation && family && family !== "none" && (
              <p className="text-xs text-muted-foreground">
                <Link href={`/explore?faith=${family}`} className="underline decoration-dotted underline-offset-4 hover:text-foreground">
                  Other {faithFamilyLabel(family)} colleges
                </Link>
              </p>
            )}
          </div>
        )}
        {view.commitment && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Scale className="size-4" style={{ color }} /> In admission{" "}
              <InfoTip term="religious-commitment" cited={citeField("reported.admission_profile.factors.religious", school)} />
            </p>
            <p className="mt-1 text-sm font-semibold">Religious affiliation or commitment: {IMPORTANCE_LABELS[view.commitment].toLowerCase()}</p>
          </div>
        )}
        {aid && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <HandCoins className="size-4" style={{ color }} /> Scholarships{" "}
              <InfoTip term="religious-scholarships" cited={citeField("reported.religion.aid_by_affiliation", school)} />
            </p>
            <p className="mt-1 text-sm font-semibold">Some of the college&apos;s own {aidKind} aid considers religious affiliation</p>
          </div>
        )}
        {view.ministries && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <UsersRound className="size-4" style={{ color }} /> Campus ministries{" "}
              <InfoTip term="campus-ministries" cited={citeField("reported.religion.campus_ministries", school)} />
            </p>
            <p className="mt-1 text-sm font-semibold">Listed among campus activities</p>
          </div>
        )}
      </div>
      )}
      {groups.length > 0 && (
        <div className={view ? "mt-6 border-t pt-5" : ""}>
          <h4 className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            Faith communities <InfoTip term="national-directory" />
          </h4>
          <div className="grid gap-5 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Users className="size-4" style={{ color }} /> {g.label}
                </p>
                <CreditedList items={g.listings} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
