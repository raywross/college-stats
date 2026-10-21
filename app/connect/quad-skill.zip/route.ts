import { buildSkillZip, SKILL_NAME } from "@/lib/api/skill";

/** GET /connect/quad-skill.zip: the Quad skill, built for this deployment's address (specs/product/assistants.md). */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const bytes = buildSkillZip(new URL(request.url).origin);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${SKILL_NAME}-skill.zip"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
