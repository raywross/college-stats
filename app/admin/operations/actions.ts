"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { realOpsDeps } from "@/lib/admin/ops";
import {
  acceptReviewItem,
  closeDataPull,
  dispatchRun,
  holdDataPull,
  mergeDataPull,
  pullNumber,
  readDispatchForm,
  rediscoverReviewItem,
  rejectReviewItem,
  type OpsState,
} from "@/lib/admin/ops-actions";

/**
 * Operations Server Actions (specs/product/admin.md "Operations: reruns and approvals"). Each one calls `requireAdmin()`
 * before it reads the form, so a signed-out visitor or a non-admin gets a 404 and nothing runs. The work, including
 * logging each action before it is sent, is in lib/admin/ops-actions.ts, which tests/admin-ops.test.mts exercises
 * with fake dependencies.
 */

const BAD_FORM: OpsState = { status: "error", message: "That form wasn't complete. Reload the page and try again." };

/** A finished action shows its result; the page re-reads GitHub so the lists catch up. */
function finish(state: OpsState): OpsState {
  if (state.status === "done") refresh();
  return state;
}

export async function dispatchAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  const admin = await requireAdmin();
  return finish(await dispatchRun(realOpsDeps(admin), readDispatchForm(form)));
}

export async function mergeAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  const admin = await requireAdmin();
  const n = pullNumber(form);
  return n === null ? BAD_FORM : finish(await mergeDataPull(realOpsDeps(admin), n));
}

export async function holdAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  const admin = await requireAdmin();
  const n = pullNumber(form);
  return n === null ? BAD_FORM : finish(await holdDataPull(realOpsDeps(admin), n));
}

export async function closeAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  const admin = await requireAdmin();
  const n = pullNumber(form);
  return n === null ? BAD_FORM : finish(await closeDataPull(realOpsDeps(admin), n));
}

/** Re-run CI for a pull request whose check never started: the `verify` run on the PR's branch. */
export async function rerunCiAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  const admin = await requireAdmin();
  const branch = typeof form.get("branch") === "string" ? (form.get("branch") as string) : "";
  return finish(await dispatchRun(realOpsDeps(admin), { run: "verify", values: {}, branch }));
}

function itemId(form: FormData): string | null {
  const id = form.get("item");
  return typeof id === "string" && id !== "" && id.length < 2000 ? id : null;
}

export async function acceptAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  const admin = await requireAdmin();
  const id = itemId(form);
  return id === null ? BAD_FORM : finish(await acceptReviewItem(realOpsDeps(admin), id));
}

export async function rejectAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  const admin = await requireAdmin();
  const id = itemId(form);
  return id === null ? BAD_FORM : finish(await rejectReviewItem(realOpsDeps(admin), id));
}

export async function rediscoverAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  const admin = await requireAdmin();
  const id = itemId(form);
  return id === null ? BAD_FORM : finish(await rediscoverReviewItem(realOpsDeps(admin), id));
}
