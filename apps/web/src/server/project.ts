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
import { getFormat } from "@film/formats";
import { LocalObjectStore, R2ObjectStore, type ObjectStore } from "@film/storage";
import { getTemplate, resolveAllText, type SubjectData } from "@film/templates";
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
 * Local disk in development, R2 in production, behind one interface.
 *
 * Keeping the local implementation real rather than a mock is what lets the
 * whole preview run with no cloud account attached.
 */
export const store = (): ObjectStore => {
  const accountId = process.env["R2_ACCOUNT_ID"];
  if (accountId === undefined || accountId === "") {
    const root = process.env["LOCAL_MEDIA_ROOT"] ?? "project/real/media";
    return new LocalObjectStore(root);
  }
  return new R2ObjectStore({
    accountId,
    bucket: process.env["R2_BUCKET"] ?? "",
    accessKeyId: process.env["R2_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"] ?? "",
  });
};

const usingLocalStore = (): boolean => {
  const id = process.env["R2_ACCOUNT_ID"];
  return id === undefined || id === "";
};

export type AssetWarning = {
  readonly assetId: string;
  readonly label: string;
  readonly code: string;
  readonly message: string;
};

export type ProjectSummary = {
  readonly id: string;
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

  const template = getTemplate(project.templateId, project.templateVersion);
  const format = getFormat(template.defaultFormatId);
  const subject = project.subjectData as SubjectData;

  const text = resolveAllText(template, subject, format);
  if (!text.ok) {
    throw new Error(`template text did not resolve:\n  ${text.failures.join("\n  ")}`);
  }

  const objects = store();
  const assetPaths: Record<string, string> = {};
  const assetSizes: Record<string, { width: number; height: number }> = {};

  for (const asset of assetRows) {
    assetPaths[asset.id] = usingLocalStore()
      ? `/api/media/${asset.storageKey}`
      : await objects.signedGetUrl(asset.storageKey, { expiresInSeconds: 900 });
    if (asset.kind !== "audio") {
      assetSizes[asset.id] = {
        width: (asset.qcMetrics as { width?: number } | null)?.width ?? 1920,
        height: (asset.qcMetrics as { height?: number } | null)?.height ?? 1080,
      };
    }
  }

  const musicKey = `music/${edl.audio.musicTrackId}.wav`;
  const musicPath = usingLocalStore()
    ? `/api/media/${musicKey}`
    : await objects.signedGetUrl(musicKey, { expiresInSeconds: 900 });

  const warnings: AssetWarning[] = assetRows.flatMap((asset) => {
    const list = (asset.warnings ?? []) as { code?: string; message?: string }[];
    return list.map((w) => ({
      assetId: asset.id,
      label: asset.questionId ?? asset.slotId ?? asset.kind,
      code: w.code ?? "WARNING",
      message: w.message ?? "",
    }));
  });

  return {
    summary: {
      id: project.id,
      status: project.status,
      templateId: project.templateId,
      templateVersion: project.templateVersion,
      subject,
      edlVersion: latest.version,
      edlVersionId: latest.id,
      approved: approvalRows.length > 0,
      warnings,
    },
    props: {
      edl,
      format,
      styling: template.styling,
      text: text.text,
      assetPaths,
      assetSizes,
      musicPath,
      audio: {
        duckAttackMs: template.audioDefaults.duckAttackMs,
        duckReleaseMs: template.audioDefaults.duckReleaseMs,
        fadeInMs: 1_500,
        fadeOutMs: 2_500,
      },
    },
  };
};
