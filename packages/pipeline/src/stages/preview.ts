import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { assets, hashInputs, type StageIdentity } from "@film/db";
import { objectKey } from "@film/storage";

import { makePreview } from "../media/preview.js";
import { permanent } from "../runtime/errors.js";
import type { StageContext } from "../runtime/runStage.js";
import type { AssetRow } from "../model.js";
import { hasPicture } from "./thumbnail.js";

/**
 * The light copy the preview plays (media/preview.ts).
 *
 * Built exactly like the thumbnail stage, for the same reasons, which that
 * file sets out at length: a stage of its own so adding it re-transcodes
 * nothing; the recipe number in both the hash and the object name, so a bump
 * both re-dispatches the work and stops the "already has one" check skipping
 * it; object first, row second. Bump the recipe when the copy should differ
 * for the same media.
 */
export const PREVIEW_RECIPE = 1;

export const previewKeyOf = (projectId: string, assetId: string, kind: AssetRow["kind"]): string =>
  objectKey({
    projectId,
    kind: "preview",
    assetId,
    name: `preview-v${String(PREVIEW_RECIPE)}.${kind === "photo" ? "jpg" : "mp4"}`,
  });

/** Same reasoning as thumbnails: somebody's grandmother, so private; the
 *  bytes under a key never change, so immutable. Fifteen minutes is the
 *  shortest a preview URL lives — the cache cannot usefully outlast it. */
export const PREVIEW_CACHE_CONTROL = "private, max-age=900, immutable";

/** A take, its copy, and room to work. */
const SCRATCH_HEADROOM_BYTES = 4 * 1024 * 1024 * 1024;
export const previewRequiresFreeBytes = (): number => SCRATCH_HEADROOM_BYTES;

/** Missing THIS recipe's copy, and ingested — it is made from the normalised
 *  file, never the original, so the timing matches what the edit was cut on. */
export const needsPreview = (row: AssetRow): boolean =>
  hasPicture(row) &&
  row.normalisedKey !== null &&
  row.previewKey !== previewKeyOf(row.projectId, row.id, row.kind);

export const previewIdentity = (row: AssetRow): StageIdentity => ({
  projectId: row.projectId,
  assetId: row.id,
  stage: "preview",
  inputHash: hashInputs({
    source: row.normalisedKey ?? "",
    kind: row.kind,
    recipe: PREVIEW_RECIPE,
  }),
});

export const runPreview = async (ctx: StageContext): Promise<string | null> => {
  if (ctx.assetId === null) throw permanent("preview was dispatched without an asset");

  const rows = await ctx.db.select().from(assets).where(eq(assets.id, ctx.assetId)).limit(1);
  const row = rows[0] as AssetRow | undefined;
  if (row === undefined) throw permanent(`asset ${ctx.assetId} no longer exists`);
  if (!hasPicture(row)) throw permanent(`asset ${row.id} is a ${row.kind}, which has no picture to preview`);
  if (row.normalisedKey === null) {
    // Transient: the dispatcher only asks after ingest, so a race settles itself.
    throw new Error("this asset has not been ingested yet");
  }
  if (!needsPreview(row)) {
    await ctx.log.info("already has this recipe's preview — left alone");
    return null;
  }

  const dir = await ctx.scratch();
  const source = join(dir, "source");
  const output = join(dir, row.kind === "photo" ? "preview.jpg" : "preview.mp4");

  const bytes = await ctx.store.get(row.normalisedKey);
  await writeFile(source, bytes);
  await makePreview(source, output, row.kind as "photo" | "video" | "interview", { signal: ctx.signal });

  const key = previewKeyOf(ctx.projectId, row.id, row.kind);
  const { size } = await stat(output);
  const stored = await ctx.store.put(key, createReadStream(output), {
    contentType: row.kind === "photo" ? "image/jpeg" : "video/mp4",
    contentLength: size,
    cacheControl: PREVIEW_CACHE_CONTROL,
  });
  await ctx.db.update(assets).set({ previewKey: key }).where(eq(assets.id, row.id));

  await ctx.log.info(
    `${(stored.byteSize / 1e6).toFixed(1)} MB preview from ${(bytes.byteLength / 1e6).toFixed(1)} MB of ${row.kind}`,
  );
  return stored.etag;
};
