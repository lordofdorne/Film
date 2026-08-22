import { eq } from "drizzle-orm";

import { projects, reopenFailedStages, type Db } from "@film/db";

/**
 * Try this film again.
 *
 * Two things have to happen together, and either alone does nothing.
 *
 *   - The project has to leave `failed`, because that status is not ACTIVE and
 *     the dispatcher never looks at it again.
 *   - The dead-end stages have to be re-openable, because the dispatcher
 *     refuses to hand out a stage that used up its attempts — so a button that
 *     only changed the status would spin once and mark the film failed again,
 *     which is worse than no button.
 *
 * `processing` rather than the status it had: everything downstream is derived
 * from rows, so the planner works out for itself what is left. A film with a
 * cut already made will not re-cut it — that compose succeeded, and succeeded
 * stages are never re-run.
 *
 * Nothing here decides WHETHER a retry is a good idea. The honest answer is
 * that most retries of a permanent failure fail the same way, and the surface
 * offering it should say so rather than promise.
 */
export const retryProject = async (
  db: Db,
  projectId: string,
): Promise<{ readonly ok: true; readonly reopened: number } | { readonly ok: false; readonly error: string }> => {
  const rows = await db
    .select({ status: projects.status })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = rows[0];
  if (project === undefined) return { ok: false, error: "no such project" };

  // Only a failed film. Anything else is either already moving or finished,
  // and "retry" on a film that is quietly rendering would throw work away.
  if (project.status !== "failed") {
    return { ok: false, error: "this film is not stuck — nothing to try again" };
  }

  const reopened = await reopenFailedStages(db, projectId);

  await db
    .update(projects)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  return { ok: true, reopened };
};
