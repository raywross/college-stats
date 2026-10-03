import Link from "next/link";
import { CalendarDays, Globe, Medal, Microscope, Shield, Trophy } from "lucide-react";
import { getData } from "@/lib/data";
import { pct } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import { CALENDAR_LABELS, DIVISION_LABELS, ROTC_LABELS, SPORT_LABELS, divisionFilterOf } from "@/lib/campus-services";
import { eventYear, type PolicyEvent } from "@/lib/events";
import type { School } from "@/lib/types";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * Athletics and programs (specs/data-expansion/campus-services.md). IPEDS checkboxes that weren't ticked read "Not
 * listed", never "No": the college may still offer it.
 */
export async function CampusServices({ school, recentMoves }: { school: School; recentMoves: PolicyEvent[] }) {
  const { citeField } = await getData();
  const a = school.campus?.athletics;
  const p = school.campus?.programs;
  const sv = school.campus?.services;
  const cal = school.campus?.calendar;
  const dis = school.demographics.disability_services;
  if (!a && !p && !cal) return null;
  const color = DOMAINS.size.color;
  const athleticsCited = citeField("campus.athletics", school);
  const programsCited = citeField("campus.programs", school);
  const division = a ? divisionFilterOf(school) : null;
  const services = sv
    ? [
        sv.counseling && "Academic and career counseling",
        sv.employment && "Help finding a job while enrolled",
        sv.placement && "Job placement after graduating",
        sv.child_care && "On-campus child care for students' children",
      ].filter((x): x is string => !!x)
    : [];

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-5 flex items-center gap-1.5 font-display text-lg font-bold">
        Athletics &amp; programs      </h3>
      <div className="grid gap-6 sm:grid-cols-2">
        {a && (
          <div className="sm:col-span-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Trophy className="size-4" style={{ color }} /> Athletics <InfoTip term="ncaa-division" cited={athleticsCited} />
            </p>
            {division || a.conference ? (
              <>
                <p className="mt-1 text-sm font-semibold">
                  {division && (division === "naia" ? "NAIA" : `NCAA ${DIVISION_LABELS[division].replace(", no football", "")}`)}
                  {division && a.conference && " · "}
                  {a.conference && (
                    <Link href={`/explore?conference=${a.conference.code}`} className="underline decoration-dotted underline-offset-4 hover:text-primary">
                      {a.conference.name}
                    </Link>
                  )}
                  <InfoTip term="athletic-conference" className="ml-1" />
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.football_conference ? (
                    <>
                      Football in the{" "}
                      <Link href={`/explore?conference=${a.football_conference.code}`} className="underline decoration-dotted underline-offset-4 hover:text-foreground">
                        {a.football_conference.name}
                      </Link>
                      .{" "}
                    </>
                  ) : null}
                  {a.sports.length > 0 &&
                    `Of the four sports the federal survey asks about, it plays ${a.sports.map((s) => SPORT_LABELS[s]).join(", ")}${a.sports.includes("football") ? "" : " (no football)"}.`}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm font-semibold">
                {a.associations.length ? "Member of a national athletic association" : "Not a member of a national athletic association"}
              </p>
            )}
            {recentMoves.map((e) => (
              <p key={`${e.key}-${e.year}`} className="mt-1.5 text-xs">
                <span className="font-semibold text-muted-foreground">Recent move: </span>
                <span className="font-semibold">
                  {e.text}, {eventYear(e)}
                </span>
              </p>
            ))}
          </div>
        )}
        {p && (
          <>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Shield className="size-4" style={{ color }} /> ROTC <InfoTip term="rotc" cited={programsCited} />
              </p>
              <p className="mt-1 text-sm font-semibold">{p.rotc.length ? p.rotc.map((b) => ROTC_LABELS[b]).join(", ") : "Not listed"}</p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Globe className="size-4" style={{ color }} /> Study abroad <InfoTip term="study-abroad" cited={programsCited} />
              </p>
              <p className="mt-1 text-sm font-semibold">{p.study_abroad ? "Offered" : "Not listed"}</p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Microscope className="size-4" style={{ color }} /> Undergraduate research <InfoTip term="undergrad-research" cited={programsCited} />
              </p>
              <p className="mt-1 text-sm font-semibold">{p.undergrad_research ? "A formal program" : p.undergrad_research === false ? "Not listed" : "Not reported"}</p>
            </div>
          </>
        )}
        {cal && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <CalendarDays className="size-4" style={{ color }} /> Calendar <InfoTip term="academic-calendar" cited={citeField("campus.calendar", school)} />
            </p>
            <p className="mt-1 text-sm font-semibold">{CALENDAR_LABELS[cal]}</p>
          </div>
        )}
      </div>
      {(services.length > 0 || dis || p?.intellectual_disability_program) && (
        <div className="mt-6 border-t pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Medal className="size-4" style={{ color }} /> Student services          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {services.map((s) => (
              <li key={s}>{s}</li>
            ))}
            {p?.intellectual_disability_program && <li>A program for students with intellectual disabilities</li>}
            {dis && (
              <li className="flex flex-wrap items-center gap-1">
                {"share" in dis ? `${pct(dis.share)} of undergrads registered with disability services` : "3% or fewer of undergrads registered with disability services"}
                <InfoTip term="disability-services" cited={citeField("demographics.disability_services", school)} />
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
