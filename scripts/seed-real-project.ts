/**
 * Loads the locally composed project into Postgres so the web preview has
 * something real to show.
 *
 *   pnpm seed:real
 *
 * A development convenience, not a pipeline stage. In production these rows are
 * written by ingest and compose as they run; this just replays their output so
 * the approval flow can be exercised without the full pipeline existing yet.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import {
  approvals,
  assets,
  createDb,
  edlVersions,
  projects,
  stageExecutions,
  users,
} from "@film/db";
import { AssetManifestSchema, EdlSchema } from "@film/edl";
import { getFormat } from "@film/formats";
import { getTemplate } from "@film/templates";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROJECT = join(ROOT, "project", "real");

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";

/** Deterministic uuid per asset id, so re-seeding is idempotent. */
const assetUuid = (index: number): string =>
  `00000000-0000-4000-8000-1${String(index).padStart(11, "0")}`;

/**
 * Where the file actually sits under project/real/media.
 *
 * Deliberately not the production objectKey() scheme: this is replaying a local
 * directory, and pretending otherwise would mean copying media around to no
 * purpose. Real ingest writes project-scoped keys.
 */
const localKey = (id: string, kind: string): string => {
  if (kind === "interview") return `interview/${id}.mp4`;
  if (kind === "video") return `broll/${id}.mp4`;
  if (kind === "audio") return `prompt/${id}.wav`;
  return `photo/${id}.jpg`;
};

const main = async (): Promise<void> => {
  const { db, pool } = createDb("web");

  const [edlRaw, manifestRaw, subjectRaw] = await Promise.all(
    ["edl.json", "manifest.json", "subject.json"].map(async (f) =>
      JSON.parse(await readFile(join(PROJECT, f), "utf8")),
    ),
  );
  const edl = EdlSchema.parse(edlRaw);
  const manifest = AssetManifestSchema.parse(manifestRaw);

  const template = getTemplate(edl.templateId, edl.templateVersion);
  const format = getFormat(template.defaultFormatId);

  // Idempotent: wipe this project and rebuild it.
  await db.delete(stageExecutions).where(eq(stageExecutions.projectId, PROJECT_ID));
  await db.delete(approvals).where(eq(approvals.projectId, PROJECT_ID));
  await db.delete(edlVersions).where(eq(edlVersions.projectId, PROJECT_ID));
  await db.delete(assets).where(eq(assets.projectId, PROJECT_ID));
  await db.delete(projects).where(eq(projects.id, PROJECT_ID));
  await db.delete(users).where(eq(users.id, OWNER_ID));

  await db.insert(users).values({ id: OWNER_ID, email: "owner@example.com" });
  await db.insert(projects).values({
    id: PROJECT_ID,
    ownerId: OWNER_ID,
    templateId: edl.templateId,
    templateVersion: edl.templateVersion,
    subjectData: subjectRaw,
    status: "awaiting_approval",
  });

  const idMap = new Map<string, string>();
  manifest.assets.forEach((asset, i) => idMap.set(asset.id, assetUuid(i)));

  for (const [i, asset] of manifest.assets.entries()) {
    /**
     * Real QC warnings, derived rather than invented.
     *
     * The takes are 1280x720 and the output is 1440x1080, so a 4:3 crop is
     * upscaled about 1.5x before any punch-in. That is exactly the kind of
     * thing the customer should see before approving — it is their call
     * whether it matters, not ours.
     */
    const warnings: { code: string; message: string }[] = [];
    if (asset.kind !== "audio" && asset.height < format.height) {
      const ratio = (format.height / asset.height).toFixed(2);
      warnings.push({
        code: "LOW_RESOLUTION",
        message:
          `Recorded at ${String(asset.width)}×${String(asset.height)}, below the ` +
          `${String(format.width)}×${String(format.height)} film. It is enlarged about ${ratio}× ` +
          "and will look a little soft. Re-recording on a phone would sharpen it.",
      });
    }

    await db.insert(assets).values({
      id: assetUuid(i),
      projectId: PROJECT_ID,
      ...("questionId" in asset ? { questionId: asset.questionId } : {}),
      ...("slotId" in asset ? { slotId: asset.slotId } : {}),
      kind: asset.kind,
      storageKey: localKey(asset.id, asset.kind),
      captureMethod: "native_upload",
      qcMetrics:
        asset.kind === "audio"
          ? { durationMs: asset.durationMs }
          : { width: asset.width, height: asset.height, durationMs: asset.durationMs ?? null },
      warnings,
    });
  }

  // The EDL references manifest asset ids; the database uses uuids. Rewrite the
  // references so the stored document is self-consistent with the asset rows.
  const remapped = JSON.parse(
    JSON.stringify(edl).replace(/"(asset_[A-Za-z0-9_]+)"/g, (whole, id: string) => {
      const uuid = idMap.get(id);
      return uuid === undefined ? whole : `"${uuid}"`;
    }),
  ) as unknown;

  await db.insert(edlVersions).values({
    projectId: PROJECT_ID,
    version: 1,
    doc: EdlSchema.parse(remapped),
    author: "compose",
  });

  const warned = manifest.assets.filter(
    (a) => a.kind !== "audio" && a.height < format.height,
  ).length;

  process.stdout.write(
    `seeded project ${PROJECT_ID}\n` +
      `  ${String(manifest.assets.length)} assets, ${String(warned)} with QC warnings\n` +
      `  EDL v1: ${String(edl.visualSegments.length)} visual, ${String(edl.speechSegments.length)} speech\n` +
      `  open http://localhost:3200/projects/${PROJECT_ID}\n`,
  );

  await pool.end();
};

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
