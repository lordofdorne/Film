import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./connection.js";
import { approvals, edlVersions, projects, renders } from "./schema/tables.js";

export type ApprovalOutcome =
  | {
      readonly ok: true;
      readonly approvalId: string;
      /** The delivery render this approval asked for. */
      readonly renderId: string;
    }
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
    /**
     * Which format to deliver. Passed in rather than looked up, because the
     * template registry lives above this package and reaching up for it would
     * invert the dependency the whole layering rests on.
     */
    readonly formatId: string;
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

  /**
   * The approval, the status and the request to render, in one transaction.
   *
   * These three must not be able to diverge. An approval with no render is a
   * customer who pressed the button and never got a film, and nothing in the
   * system would notice; a render with no approval is a film delivered against
   * a cut nobody authorised. Committing them together makes both impossible
   * rather than merely unlikely.
   *
   * Note what is NOT here: enqueuing. The database is the source of truth and
   * the queue is an accelerator, so approval writes a row and the worker's
   * dispatcher turns it into a job. A queue insert in this transaction would
   * either be outside it — and so lose-able — or inside it, and pg-boss is not
   * ours to hold a transaction open across.
   */
  return db.transaction(async (tx): Promise<ApprovalOutcome> => {
    const inserted = await tx
      .insert(approvals)
      .values({
        projectId: input.projectId,
        edlVersionId: input.edlVersionId,
        approvedBy: input.approvedBy,
      })
      .returning({ id: approvals.id });

    await tx
      .update(projects)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));

    // Usually already requested — compose asks for the render the moment a
    // cut exists, so it is made while the customer watches (see
    // requestDeliveryRender). Reused, never duplicated.
    const renderId = await requestDeliveryRender(tx, input.edlVersionId, input.formatId);

    const row = inserted[0];
    if (row === undefined) throw new Error("approval insert returned no row");
    return { ok: true, approvalId: row.id, renderId };
  });
};

/**
 * The delivery render for one cut: the one already requested, or a new one.
 *
 * Called twice in a film's life. Compose calls it the moment a cut exists, so
 * the full-quality film is being made while the customer watches the preview
 * — a three-minute film and its notes take about as long to watch as to
 * render, so approving the cut they were shown usually finds the film made.
 * Approval calls it again and gets the same row back.
 *
 * Never two for one cut. A render's stage identity is the cut, the format and
 * the recipe — not the row — so a second row would find the work "done" under
 * the first one's identity and be delivered with no file. Reusing the row is
 * what keeps "the render" one thing.
 *
 * Rendering before approval is safe because DELIVERY is what waits for it:
 * the dispatcher plans deliver only for an approved cut, and the download
 * joins on the approval. An unapproved render is a file nobody can reach. Its
 * cost is a render wasted when somebody never approves — today, only a film
 * abandoned at the preview.
 */
export const requestDeliveryRender = async (
  db: Pick<Db, "select" | "insert">,
  edlVersionId: string,
  formatId: string,
): Promise<string> => {
  const existing = await db
    .select({ id: renders.id })
    .from(renders)
    .where(
      and(
        eq(renders.edlVersionId, edlVersionId),
        eq(renders.formatId, formatId),
        eq(renders.quality, "delivery"),
      ),
    )
    .orderBy(desc(renders.createdAt))
    .limit(1);
  const found = existing[0];
  if (found !== undefined) return found.id;

  const inserted = await db
    .insert(renders)
    .values({ edlVersionId, formatId, quality: "delivery", status: "queued" })
    .returning({ id: renders.id });
  const row = inserted[0];
  if (row === undefined) throw new Error("render insert returned no row");
  return row.id;
};

/** Delivery renders requested for a project, newest first. */
export const deliveryRenders = async (
  db: Db,
  projectId: string,
): Promise<
  { id: string; edlVersionId: string; formatId: string; status: string; outputKey: string | null }[]
> =>
  db
    .select({
      id: renders.id,
      edlVersionId: renders.edlVersionId,
      formatId: renders.formatId,
      status: renders.status,
      outputKey: renders.outputKey,
    })
    .from(renders)
    .innerJoin(edlVersions, eq(renders.edlVersionId, edlVersions.id))
    .where(and(eq(edlVersions.projectId, projectId), eq(renders.quality, "delivery")))
    .orderBy(desc(renders.createdAt));

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
