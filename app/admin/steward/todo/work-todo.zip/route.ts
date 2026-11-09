import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { WORK_TODO_SKILL_NAME, buildWorkTodoZip } from "@/lib/steward/work-todo-skill";

/**
 * GET /admin/steward/todo/work-todo.zip (specs/product/todo-browser-agent.md "Step 1"): the assistant's playbook as a
 * skill zip, its links naming this deployment, for Claude's Upload a skill. Admin only: `requireAdmin()` runs first,
 * and anyone else gets the same 404 as any /admin page.
 */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const bytes = buildWorkTodoZip(request.nextUrl.origin);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${WORK_TODO_SKILL_NAME}-skill.zip"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
