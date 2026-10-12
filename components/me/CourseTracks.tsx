import { noteText } from "@/lib/chances/notes";
import type { CourseTracks as CourseTracksData } from "@/lib/chances/depth";

/**
 * "Tracks" under the rigor reading (depth.md "Course tracks", "Where it shows"): one sentence per subject family the
 * student has courses in, the major's expected families first — Deep, Steady, or Light, with the sentence
 * `courseTracks` already wrote (lib/chances/notes.ts `depth.courses.*`). Shown on `/me` → Courses and the planner's
 * Scores tab → Courses, under the existing rigor reading. Renders nothing without any family to report.
 */
export function CourseTracks({ tracks }: { tracks: CourseTracksData }) {
  if (tracks.families.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Tracks</p>
      <ul className="space-y-1 text-sm">
        {tracks.families.map((f) => (
          <li key={f.family} className="text-muted-foreground">
            {noteText(f.note)}
          </li>
        ))}
      </ul>
    </div>
  );
}
