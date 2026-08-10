import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "./connection.js";
import { isProjectId } from "./ids.js";
import { approvals, edlVersions, projects, renders } from "./schema/tables.js";

export type DeliverableFilm = {
  readonly renderId: string;
  readonly edlVersionId: string;
  /** The cut number the customer approved, for the filename and the page. */
  readonly edlVersion: number;
  readonly formatId: string;
  /** Where the finished file is. Never handed to a browser directly. */
  readonly outputKey: string;
  readonly approvedAt: Date;
};

/**
 * The one file a project is allowed to hand over, or nothing.
 *
 * The join to `approvals` is the point of this function, not incidental
 * plumbing. "Deliver requires an approval for that exact cut" is an invariant
 * of the whole system, and the download surface is where the film actually
 * reaches a person — so it re-establishes the rule from rows rather than
 * trusting that whatever wrote the render row had checked. A render can exist
 * without an approval today (a re-render, a backfill, a future admin path),
 * and any of those becoming downloadable would mean sending someone a film
 * they never watched.
 *
 * Newest approved-and-rendered cut wins. A customer who approved v1, received
 * it, and then had a v2 composed can still download the film they approved:
 * v2 is not offered until they approve it too.
 *
 * Returns null for every not-yet state — no approval, still rendering, render
 * failed. The caller distinguishes those with `deliveryRenders`; this function
 * answers only "is there a film to give them".
 */
export const deliverableFilm = async (
  db: Db,
  projectId: string,
): Promise<DeliverableFilm | null> => {
  // A string that cannot be a project id has no film. Postgres would raise on
  // the uuid cast instead, which a route turns into a 500.
  if (!isProjectId(projectId)) return null;

  const rows = await db
    .select({
      renderId: renders.id,
      edlVersionId: renders.edlVersionId,
      edlVersion: edlVersions.version,
      formatId: renders.formatId,
      outputKey: renders.outputKey,
      approvedAt: approvals.approvedAt,
    })
    .from(renders)
    .innerJoin(edlVersions, eq(renders.edlVersionId, edlVersions.id))
    // Inner join, not a lookup afterwards: an unapproved render must not be
    // able to fall through as a row with a null approval.
    .innerJoin(approvals, eq(approvals.edlVersionId, renders.edlVersionId))
    .where(
      and(
        eq(edlVersions.projectId, projectId),
        eq(renders.quality, "delivery"),
        eq(renders.status, "succeeded"),
        isNotNull(renders.outputKey),
      ),
    )
    .orderBy(desc(edlVersions.version), desc(renders.createdAt))
    .limit(1);

  const row = rows[0];
  if (row === undefined || row.outputKey === null) return null;

  return {
    renderId: row.renderId,
    edlVersionId: row.edlVersionId,
    edlVersion: row.edlVersion,
    formatId: row.formatId,
    outputKey: row.outputKey,
    approvedAt: row.approvedAt,
  };
};

/**
 * What to call the file when it lands in someone's Downloads folder.
 *
 * `projects/<uuid>/render/delivery-landscape-classic-v1.mp4` is a storage key,
 * addressed for the system's convenience. It is a poor name for something a
 * person keeps for the rest of their life.
 *
 * Everything outside a conservative set is dropped rather than escaped. This
 * string ends up in a Content-Disposition header and in a filesystem, and the
 * characters that matter to those two — quotes, newlines, slashes, control
 * codes — are exactly the ones a name should never have needed.
 */
export const filmFilename = (input: {
  readonly subjectName: string;
  readonly edlVersion: number;
}): string => {
  const cleaned = input.subjectName
    // Replaced with a space, not deleted: a newline separates two words, and
    // removing it outright would weld them together.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/["'\\/:*?<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  const name = cleaned === "" ? "Life Advice" : `${cleaned} — Life Advice`;
  return `${name} (v${String(input.edlVersion)}).mp4`;
};

/** The subject's name, for the filename and the page heading. */
export const subjectNameOf = async (db: Db, projectId: string): Promise<string> => {
  const rows = await db
    .select({ subjectData: projects.subjectData })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const data = rows[0]?.subjectData as { subjectName?: string } | undefined;
  return data?.subjectName ?? "";
};
