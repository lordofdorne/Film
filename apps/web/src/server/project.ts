import "server-only";

import { desc, eq } from "drizzle-orm";
import {
  approvals,
  assets,
  createDb,
  edlVersions,
  projects,
  type Db,
} from "@film/db";
import { EdlSchema, type EDL } from "@film/edl";
import { buildManifest, isMusicBed, qcOf } from "@film/pipeline/model";
import { storeFromEnv, usingLocalStore, type ObjectStore } from "@film/storage";
import type { SubjectData } from "@film/templates";
// From "./props", not "./composition".
//
// The composition entry pulls in React and Remotion, and importing it for a
// value here drags the whole renderer into the server module graph — where
// Next's page-data collection runs it outside a React tree and Remotion fails
// on a missing createContext. The props builder needs none of that.
import { buildProjectProps } from "@film/render/props";
import type { FilmProps } from "@film/render/composition";

/**
 * The browser never talks to Postgres.
 *
 * Supabase Auth supplies identity and session, not a client-side data layer.
 * Every read goes through server code, and "server-only" makes importing this
 * from a client component a build error rather than a runtime surprise.
 */

let cached: Db | undefined;

const db = (): Db => {
  cached ??= createDb("web").db;
  return cached;
};

/**
 * The same store the worker writes to.
 *
 * Shared factory rather than one construction per caller: if the app and the
 * worker disagree about the root, the symptom is a blank preview with no error
 * anywhere, which is a genuinely hard afternoon.
 */
export const store = (): ObjectStore => storeFromEnv();

export type AssetWarning = {
  readonly assetId: string;
  readonly label: string;
  readonly code: string;
  readonly message: string;
};

export type ProjectSummary = {
  readonly id: string;
  /** Who owns this project. With no auth, this is also who approves it. */
  readonly ownerId: string;
  readonly status: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly subject: SubjectData;
  readonly edlVersion: number;
  readonly edlVersionId: string;
  readonly approved: boolean;
  readonly warnings: AssetWarning[];
};

export const listProjects = async (): Promise<
  { id: string; status: string; subjectName: string }[]
> => {
  const rows = await db()
    .select({ id: projects.id, status: projects.status, subjectData: projects.subjectData })
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    subjectName: (r.subjectData as { subjectName?: string }).subjectName ?? "Untitled",
  }));
};

/**
 * A project, its newest EDL, and everything needed to preview it.
 *
 * Asset URLs are resolved HERE, immediately before preview — they never live
 * in the EDL, which carries only stable ids. In production they are short-TTL
 * signed URLs; locally they are routed through this app so private storage is
 * never exposed directly.
 */
export const loadProjectForPreview = async (
  projectId: string,
): Promise<{ summary: ProjectSummary; props: FilmProps } | null> => {
  const projectRows = await db().select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const project = projectRows[0];
  if (project === undefined) return null;

  const versionRows = await db()
    .select()
    .from(edlVersions)
    .where(eq(edlVersions.projectId, projectId))
    .orderBy(desc(edlVersions.version))
    .limit(1);
  const latest = versionRows[0];
  if (latest === undefined) return null;

  const assetRows = await db().select().from(assets).where(eq(assets.projectId, projectId));

  const approvalRows = await db()
    .select({ id: approvals.id })
    .from(approvals)
    .where(eq(approvals.edlVersionId, latest.id))
    .limit(1);

  // Parsed, not trusted. The document was validated when it was written, but a
  // stored jsonb column is still an untyped boundary on the way back in.
  const edl: EDL = EdlSchema.parse(latest.doc);
  const subject = project.subjectData as SubjectData;

  /**
   * Assets are served from what INGEST produced, not from the original.
   *
   * The original is whatever the customer's phone recorded — variable frame
   * rate, rotation in a container tag, wildly uneven levels. The film is cut
   * against the normalised file, so previewing the original would show a
   * different edit from the one being approved.
   */
  const objects = store();
  const resolve = async (key: string): Promise<string> =>
    usingLocalStore()
      ? `/api/media/${key}`
      : objects.signedGetUrl(key, { expiresInSeconds: 900 });

  const assetPaths: Record<string, string> = {};
  let musicPath = "";
  for (const asset of assetRows) {
    const key = asset.normalisedKey ?? asset.storageKey;
    if (isMusicBed(asset)) musicPath = await resolve(key);
    else assetPaths[asset.id] = await resolve(key);
  }

  const bed = assetRows.find(isMusicBed);
  const warnings: AssetWarning[] = assetRows.flatMap((asset) => {
    const list = (asset.warnings ?? []) as { code?: string; message?: string }[];
    return list.map((w) => ({
      assetId: asset.id,
      label: asset.questionId ?? asset.slotId ?? asset.kind,
      code: w.code ?? "WARNING",
      message: w.message ?? "",
    }));
  });

  /**
   * The same props builder the worker uses.
   *
   * "Preview is the same composition as delivery" is what makes approving in a
   * browser mean anything, and it does not survive two places assembling the
   * props. Only the paths differ: signed URLs here, local files there.
   */
  const props = buildProjectProps({
    edl,
    manifest: buildManifest(assetRows),
    subject,
    templateId: project.templateId,
    templateVersion: project.templateVersion,
    assetPaths,
    musicPath,
    ...(bed === undefined ? {} : { musicTrack: qcOf(bed).musicTrack }),
    allowPlaceholderMusic: process.env["ALLOW_UNLICENSED_MUSIC"] === "1",
  });

  return {
    summary: {
      id: project.id,
      ownerId: project.ownerId,
      status: project.status,
      templateId: project.templateId,
      templateVersion: project.templateVersion,
      subject,
      edlVersion: latest.version,
      edlVersionId: latest.id,
      approved: approvalRows.length > 0,
      warnings,
    },
    props,
  };
};
