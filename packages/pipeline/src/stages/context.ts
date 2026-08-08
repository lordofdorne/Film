import { asc, eq } from "drizzle-orm";
import { assets, projects, type Db } from "@film/db";

import { permanent } from "../runtime/errors.js";
import type { AssetRow, ProjectRow } from "../model.js";

/**
 * A project row, or a permanent failure.
 *
 * Permanent because a stage whose project has been deleted is not going to
 * find it on the fourth attempt. This happens legitimately: a deletion request
 * lands while work is already in flight.
 */
export const loadProject = async (db: Db, projectId: string): Promise<ProjectRow> => {
  const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const row = rows[0];
  if (row === undefined) throw permanent(`project ${projectId} no longer exists`);
  return row;
};

/**
 * Every asset of a project, in a stable order.
 *
 * Ordered by creation because the order feeds compose's input hash, and a hash
 * that depends on however Postgres felt like returning rows would invalidate
 * cached work at random.
 */
export const loadAssets = async (db: Db, projectId: string): Promise<AssetRow[]> =>
  db
    .select()
    .from(assets)
    .where(eq(assets.projectId, projectId))
    .orderBy(asc(assets.createdAt), asc(assets.id));
