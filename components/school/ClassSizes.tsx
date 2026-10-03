import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { CLASS_SIZE_BINS, classSizeShareOver50, classSizeShareUnder20, ratioBasis, ratioText } from "@/lib/cds/academics-display";
import { pct } from "@/lib/format";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";
import { Block } from "@/components/profile/Panel";
import { ClassSizeHistogram } from "@/components/charts/ClassSizeHistogram";
import { ProgramChips } from "@/components/school/ProgramChips";

type Cite = (path: FieldPath, school?: School) => Cited;

/**
 * Class sizes (specs/data-expansion/cds-academics.md): "N% of classes have fewer than 20 students" over a 7-bar
 * histogram of the college's class sections (CDS I-3), with the standing "sections, not students" caveat. Renders
 * nothing without `reported.academics.class_sections`.
 */
export function ClassSizes({ school, cite, color, id }: { school: School; cite: Cite; color: string; id?: string }) {
  const c = school.reported?.academics?.class_sections;
  const under20 = c ? classSizeShareUnder20(c.sections) : null;
  if (!c || under20 === null) return null;
  const over50 = classSizeShareOver50(c.sections);
  return (
    <Block id={id} title={<>Class sizes <InfoTip term="class-section" cited={cite("reported.academics.class_sections", school)} /></>}>
      <p className="font-display text-3xl font-extrabold">{pct(under20)}</p>
      <MetricLabel cited={cite("derived.class_share_under_20", school)} className="mb-5 text-sm text-muted-foreground">
        of classes have fewer than 20 students
        {over50 !== null && over50 > 0 ? `; ${pct(over50)} have 50 or more` : ""}
      </MetricLabel>
      <ClassSizeHistogram bins={c.sections} labels={CLASS_SIZE_BINS} highlight={2} color={color} />
      <p className="mt-4 text-xs text-muted-foreground">
        This counts class <strong className="font-semibold text-foreground">sections</strong>, not students: a lecture of 300 is one section, so a student is more
        likely to sit in a large class than the share of sections suggests. Labs and discussion sections are counted separately and left out here.
      </p>
    </Block>
  );
}

/**
 * The college's own student-to-faculty ratio from its Common Data Set (I-2), as a second line under the federal figure.
 * Never merged with it or flagged as a discrepancy: the two are defined differently. `standalone` when there is no
 * federal figure to sit under.
 */
export function CdsRatioLine({ school, cite, standalone = false }: { school: School; cite: Cite; standalone?: boolean }) {
  const r = school.reported?.academics?.student_faculty_ratio;
  if (!r) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      {standalone ? "The college reports" : "The college also reports"} <span className="font-semibold text-foreground">{ratioText(r.ratio)}</span> in its Common Data Set
      {ratioBasis(r)}. <InfoTip term="cds-student-faculty-ratio" cited={cite("reported.academics.student_faculty_ratio", school)} />
    </p>
  );
}

/**
 * The academics page's CDS blocks as one element: class sizes, the college's own ratio when there is no federal
 * figure (otherwise it sits under the federal tile), and programs & curriculum.
 */
export function CdsAcademics({ school, cite, color, hasFederalRatio }: { school: School; cite: Cite; color: string; hasFederalRatio: boolean }) {
  const a = school.reported?.academics;
  if (!a) return null;
  return (
    <>
      <ClassSizes id="class-sizes" school={school} cite={cite} color={color} />
      {!hasFederalRatio && a.student_faculty_ratio && (
        <Block id="cds-ratio" title="Students per faculty member">
          <CdsRatioLine school={school} cite={cite} standalone />
        </Block>
      )}
      <ProgramChips id="programs" school={school} cite={cite} />
    </>
  );
}
