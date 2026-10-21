import { getData } from "@/lib/data";
import { lookupKeyInfo } from "@/lib/api/auth";
import { withApiKey } from "@/lib/api/handler";
import { API_KEY_LIMITS } from "@/lib/api/keys";
import { apiJson } from "@/lib/api/respond";

/**
 * GET /api/v1/me (specs/product/data-api.md "Endpoints"): the calling key and its owner, for checking a key works. The
 * owner's display name (never the email), the key's name, prefix, tier, and dates (api_key_info()), today's count as
 * api_key_use() just counted it, and the limits. When the extra read fails the names come back null; the count and
 * limits are always there.
 */
export const GET = withApiKey("me", async ({ request, principal }) => {
  const [info, { getMeta }] = await Promise.all([lookupKeyInfo(request), getData()]);
  const body = {
    owner: { display_name: info?.display_name ?? null },
    key: {
      id: principal.keyId,
      name: info?.key_name ?? null,
      prefix: info?.key_prefix ?? null,
      tier: principal.tier,
      created: info?.created ?? null,
      last_used_at: info?.last_used_at ?? null,
    },
    used_today: principal.usedToday,
    limits: { per_day: principal.limitPerDay, per_minute: API_KEY_LIMITS.perMinute, keys_per_user: API_KEY_LIMITS.keysPerUser },
  };
  return apiJson(body, { retrieved: getMeta().retrieved, request });
});
