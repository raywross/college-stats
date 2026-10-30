/**
 * `GET /advisor/essays/package/[unit]/export?format=docx|txt`: the college's package download (specs/product/
 * essays/workspace.md "The round trip": "Download the package for a college"). Reuses the package page's own
 * assembly so the download always matches what's on screen; the viewer's own session decides what it can read, the
 * same as the page and the per-draft export route.
 */
import { authConfigured } from "@/lib/auth";
import { getData } from "@/lib/data";
import { activitiesForPackage, packageDocxBuffer, packagePromptRefs, packageTxt, type PackageEssay } from "@/lib/essays/docx";
import { essaysViewer, promptLookup, readEssay, readEssays } from "@/lib/essays/load";
import { resolvePrompt } from "@/lib/essays/prompts";
import { refsOf } from "@/lib/essays/rows";
import { profileFor } from "@/lib/student-profile-store";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function filenameOf(collegeName: string, ext: string): string {
  const base = collegeName.trim().replace(/[^\w -]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "college";
  return `${base} essay package.${ext}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ unit: string }> }) {
  const { unit } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "docx" && format !== "txt") return new Response("Unknown format.", { status: 400 });
  if (!authConfigured()) return new Response("Not found", { status: 404 });

  const viewer = await essaysViewer(url.searchParams.get("for") ?? undefined);
  if (viewer.kind !== "ready") return new Response("Sign in first.", { status: 401 });

  const { getSchoolById } = await getData();
  const school = getSchoolById(unit);
  if (!school) return new Response("Not found", { status: 404 });

  const [lookup, read, profileAccess] = await Promise.all([promptLookup(), readEssays(viewer.student.id, viewer), profileFor(viewer.student.id)]);
  if (read.kind !== "ready") return new Response("Not found", { status: 404 });

  const commonApp = !!school.apply?.common_app;
  const coalitionPrompts = school.coalition ? lookup.platform?.coalition?.prompts ?? [] : [];
  const refs = packagePromptRefs(lookup.schoolRecord(unit)?.essays ?? null, { commonApp, coalitionPrompts });
  const matched = refs.map((ref) => ({ ref, essay: read.essays.find((e) => refsOf(e, read.links).includes(ref)) ?? null }));

  const bodies = new Map<string, string>();
  const uniqueIds = [...new Set(matched.flatMap((m) => (m.essay ? [m.essay.id] : [])))];
  await Promise.all(
    uniqueIds.map(async (id) => {
      const one = await readEssay(id, viewer);
      if (one.kind === "ready") bodies.set(id, one.essay.body);
    }),
  );

  const essays: PackageEssay[] = matched.map(({ ref, essay }) => {
    const prompt = resolvePrompt(ref, lookup);
    const body = essay ? bodies.get(essay.id) ?? "" : "";
    return { title: prompt.found ? prompt.title : "Prompt not on file", promptText: prompt.text, limit: prompt.limit, required: prompt.required, body, started: !!essay && body.trim().length > 0 };
  });
  const activities = activitiesForPackage(profileAccess?.data.academics.activities ?? []);

  if (format === "txt") {
    return new Response(packageTxt({ collegeName: school.name, essays, activities }), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${filenameOf(school.name, "txt")}"` },
    });
  }

  const buffer = await packageDocxBuffer({ collegeName: school.name, essays, activities });
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": DOCX_MIME, "Content-Disposition": `attachment; filename="${filenameOf(school.name, "docx")}"` },
  });
}
