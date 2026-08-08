import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./connection.js";
import { approvals, edlVersions, projects } from "./schema/tables.js";

export type ApprovalOutcome =
  | { readonly ok: true; readonly approvalId: string }
  | {
      readonly ok: false;
      readonly reason: "unknown_version" | "superseded" | "already_approved";
      readonly message: string;
    };

/**
 * Record a customer's approval of one specific cut.
 *
 * Nothing renders at delivery quality and nothing is emailed before this row
 * exists. It is written against an EDL VERSION, never against a project,
 * because approving one cut must never authorise delivery of a different one —
 * which is also why edl_versions is append-only and every edit produces a new
 * version instead of mutating the old.
 */
export const approveVersion = async (
  db: Db,
  input: {
    readonly projectId: string;
    readonly edlVersionId: string;
    readonly approvedBy: string;
  },
): Promise<ApprovalOutcome> => {
  const versions = await db
    .select({ id: edlVersions.id, version: edlVersions.version })
    .from(edlVersions)
    .where(eq(edlVersions.projectId, input.projectId))
    .orderBy(desc(edlVersions.version));

  const target = versions.find((v) => v.id === input.edlVersionId);
  if (target === undefined) {
    return {
      ok: false,
      reason: "unknown_version",
      message: "that cut does not belong to this project",
    };
  }

  /**
   * Refuse to approve a superseded cut.
   *
   * Between the page rendering and the button being pressed, a re-compose can
   * produce a newer version. Approving here would authorise delivery of a film
   * the customer never watched, which is the one mistake this flow exists to
   * make impossible.
   */
  const newest = versions[0];
  if (newest !== undefined && newest.id !== input.edlVersionId) {
    return {
      ok: false,
      reason: "superseded",
      message:
        `this cut has been superseded by version ${String(newest.version)} — ` +
        "reload and watch that one before approving",
    };
  }

  const existing = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(
        eq(approvals.projectId, input.projectId),
        eq(approvals.edlVersionId, input.edlVersionId),
      ),
    )
    .limit(1);

  // Approving twice is a double-click, not an error worth showing anyone.
  const already = existing[0];
  if (already !== undefined) {
    return { ok: false, reason: "already_approved", message: "this cut is already approved" };
  }

  const inserted = await db
    .insert(approvals)
    .values({
      projectId: input.projectId,
      edlVersionId: input.edlVersionId,
      approvedBy: input.approvedBy,
    })
    .returning({ id: approvals.id });

  await db
    .update(projects)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(projects.id, input.projectId));

  const row = inserted[0];
  if (row === undefined) throw new Error("approval insert returned no row");
  return { ok: true, approvalId: row.id };
};

/** The cut a customer is currently being shown, if any. */
export const latestEdlVersion = async (
  db: Db,
  projectId: string,
): Promise<{ id: string; version: number } | null> => {
  const rows = await db
    .select({ id: edlVersions.id, version: edlVersions.version })
    .from(edlVersions)
    .where(eq(edlVersions.projectId, projectId))
    .orderBy(desc(edlVersions.version))
    .limit(1);
  return rows[0] ?? null;
};
