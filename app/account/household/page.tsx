import { redirect } from "next/navigation";
import { connection } from "next/server";

/**
 * /account/household moved to /household, the household hub (specs/product/household-hub.md). Rendered per request so
 * the redirect is a real HTTP redirect (and #home on old links carries over).
 */
export default async function OldHouseholdPage() {
  await connection();
  redirect("/household");
}
