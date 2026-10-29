/**
 * `GET /advisor/essays/[id]/export?format=docx|txt` (the Essays build brief "Shared contracts" "Routes"): one
 * draft, downloaded (specs/product/essays/workspace.md "The round trip"). The signed-in viewer's own session reads
 * it (`readEssay`, lib/essays/load.ts), so row-level security decides — the viewer's own draft, or a guardian's
 * household's; anything else is a 404, same as the editor page. `?for=` picks the guardian's child, as elsewhere in
 * the workspace.
 */
import { authConfigured } from "@/lib/auth";
import { draftDocxBuffer, draftTxt } from "@/lib/essays/docx";
import { essaysViewer, promptLookup, readEssay } from "@/lib/essays/load";
import { resolvePrompt } from "@/lib/essays/prompts";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function filenameOf(title: string, ext: string): string {
  const base = title.trim().replace(/[^\w -]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "essay";
  return `${base}.${ext}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "docx" && format !== "txt") return new Response("Unknown format.", { status: 400 });
  if (!authConfigured()) return new Response("Not found", { status: 404 });

  const viewer = await essaysViewer(url.searchParams.get("for") ?? undefined);
  if (viewer.kind !== "ready") return new Response("Sign in first.", { status: 401 });

  const read = await readEssay(id, viewer);
  if (read.kind !== "ready") return new Response("Not found", { status: 404 });
  const { essay } = read;

  const lookup = await promptLookup();
  const prompt = resolvePrompt(essay.prompt_ref, lookup);
  const title = essay.title || prompt.title;

  if (format === "txt") {
    return new Response(draftTxt({ title, promptText: prompt.text, body: essay.body }), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameOf(title, "txt")}"`,
      },
    });
  }

  const buffer = await draftDocxBuffer({ title, promptText: prompt.text, limit: prompt.limit, required: prompt.required, body: essay.body });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename="${filenameOf(title, "docx")}"`,
    },
  });
}
