"use server";

import { revalidatePath } from "next/cache";
import { approveVersion, createDb, type Db } from "@film/db";

let cached: Db | undefined;
const db = (): Db => {
  cached ??= createDb("web").db;
  return cached;
};

export type ApprovalResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Thin wrapper over the tested approval logic in @film/db.
 *
 * The decision — is this cut the newest, has it already been approved — lives
 * there so it can be tested against a real database. A server action cannot
 * be, since it drags in Next's request context. Keeping the rule out of here
 * is what makes it verifiable.
 */
export const approveEdlVersion = async (
  projectId: string,
  edlVersionId: string,
  approvedBy: string,
): Promise<ApprovalResult> => {
  const outcome = await approveVersion(db(), { projectId, edlVersionId, approvedBy });
  if (outcome.ok) {
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  }
  // An already-approved cut is a double-click; treat it as success.
  if (outcome.reason === "already_approved") {
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  }
  return { ok: false, error: outcome.message };
};
