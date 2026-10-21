import { getData } from "@/lib/data";
import { badRequest, withApiKey } from "@/lib/api/handler";
import { apiJson } from "@/lib/api/respond";
import { fieldRegistry, fieldTopics } from "@/lib/api/serialize";

/**
 * GET /api/v1/fields (specs/product/data-api.md "Endpoints"): the public field registry (lib/fields.ts less hidden
 * fields) with each field's default source and release year from lineage; `topic=` narrows it to one topic.
 */
export const GET = withApiKey("fields", async ({ request }) => {
  const topic = new URL(request.url).searchParams.get("topic");
  const topics: string[] = fieldTopics();
  if (topic !== null && !topics.includes(topic)) return badRequest("topic", `use one of ${topics.join(", ")}`);
  const { getMeta } = await getData();
  const meta = getMeta();
  const fields = fieldRegistry(meta).filter((f) => topic === null || f.topic === topic);
  return apiJson({ fields }, { retrieved: meta.retrieved, request });
});
