"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { approveVersion, createDb, projects, type Db } from "@film/db";
import { getFormat } from "@film/formats";
import { getTemplate } from "@film/templates";

import { accessToProject } from "./auth.js";

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
 * there so it can be tested against a real database. What lives HERE is who
 * may ask: a server action is callable directly, whatever the page rendered,
 * so this checks ownership itself and derives every identity server-side.
 * Nothing about who is approving, or which template governs, is taken from
 * the browser — an approval is a signature, and a signature the client could
 * fill in for someone else is not one.
 */
export const approveEdlVersion = async (
  projectId: string,
  edlVersionId: string,
): Promise<ApprovalResult> => {
  const access = await accessToProject(projectId);
  if (!access.allowed) return { ok: false, error: "no such project" };

  const rows = await db()
    .select({
      ownerId: projects.ownerId,
      templateId: projects.templateId,
      templateVersion: projects.templateVersion,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = rows[0];
  if (project === undefined) return { ok: false, error: "no such project" };

  // The signed-in owner. On a server with no auth configured, the owner row
  // itself — the same person guardProject let through.
  const approvedBy = access.user?.id ?? project.ownerId;

  const format = getFormat(
    getTemplate(project.templateId, project.templateVersion).defaultFormatId,
  );
  const outcome = await approveVersion(db(), {
    projectId,
    edlVersionId,
    approvedBy,
    formatId: format.id,
  });
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
