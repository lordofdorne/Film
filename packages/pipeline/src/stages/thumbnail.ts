import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { assets, hashInputs, type StageIdentity } from "@film/db";
import { objectKey } from "@film/storage";

import { makeThumbnail } from "../media/thumbnail.js";
import { permanent } from "../runtime/errors.js";
import type { StageContext } from "../runtime/runStage.js";
import { isMusicBed, type AssetRow } from "../model.js";

/**
 * The recipe's version, in the input hash.
 *
 * Bump it when the picture this produces should differ for the same media — a
 * different size, a different frame. Cheap to bump, unlike ingest's: this
 * stage re-runs on its own without invalidating a transcode, a cut or a render.
 */
export const THUMBNAIL_RECIPE = 1;

/** A frame and a downscale. Room for the media it reads and nothing more. */
const SCRATCH_HEADROOM_BYTES = 2 * 1024 * 1024 * 1024;

export const thumbnailRequiresFreeBytes = (): number => SCRATCH_HEADROOM_BYTES;

/**
 * Which assets have a picture in them at all.
 *
 * Not the music bed, and not an interviewer's recorded question: they are
 * sound, and asking ffmpeg for a frame of them fails in a way that would put a
 * red mark on a perfectly good film.
 */
export const hasPicture = (row: AssetRow): boolean =>
  !isMusicBed(row) && (row.kind === "photo" || row.kind === "video" || row.kind === "interview");

export const thumbnailIdentity = (row: AssetRow): StageIdentity => ({
  projectId: row.projectId,
  assetId: row.id,
  stage: "thumbnail",
  inputHash: hashInputs({
    // Whichever this stage would read. Normalised when there is one, so a
    // re-ingest produces a fresh thumbnail; the original before that.
    source: row.normalisedKey ?? row.storageKey,
    kind: row.kind,
    recipe: THUMBNAIL_RECIPE,
  }),
});

/**
 * Make the small picture a list can afford to draw.
 *
 * Its own stage rather than a line inside ingest, and that is the whole design
 * decision here. Ingest's input hash decides what is cached, so teaching ingest
 * a new output means bumping its recipe — which re-transcodes every take in
 * every unfinished film, invalidates the cut, and re-renders it. Minutes of a
 * worker's time per project to produce a 40 KB JPEG. And it would STILL not
 * reach a film that has already been delivered, because the dispatcher only
 * plans active projects, so the films most likely to be sitting there with slow
 * hubs are exactly the ones a recipe bump cannot touch.
 *
 * A hash of its own costs one row per asset and runs once.
 *
 * Ingest writes one too, while it already has the file open and the download is
 * free. This stage finds it already there and says so — the same "a better
 * source got here first" check transcribe makes about a typed selection.
 */
export const runThumbnail = async (ctx: StageContext): Promise<string | null> => {
  if (ctx.assetId === null) throw permanent("thumbnail was dispatched without an asset");

  const rows = await ctx.db.select().from(assets).where(eq(assets.id, ctx.assetId)).limit(1);
  const row = rows[0];
  if (row === undefined) throw permanent(`asset ${ctx.assetId} no longer exists`);

  if (!hasPicture(row as AssetRow)) {
    throw permanent(`asset ${row.id} is a ${row.kind}, which has no picture to show`);
  }

  if (row.thumbnailKey !== null) {
    await ctx.log.info("ingest already made one while it had the file — left alone");
    return null;
  }

  /**
   * The normalised object when there is one, the original when there is not.
   *
   * Both are the same picture; the normalised file is smaller and already
   * rotated the right way up, so it is preferred. But a thumbnail is worth
   * having during the seconds before ingest finishes, and refusing to make one
   * without a normalised file would put a placeholder on the card for exactly
   * as long as the customer is standing there looking at it.
   */
  const source = row.normalisedKey ?? row.storageKey;

  const dir = await ctx.scratch();
  const media = join(dir, "source");
  const output = join(dir, "thumb.jpg");

  const bytes = await ctx.store.get(source);
  await writeFile(media, bytes);
  await makeThumbnail(media, output, row.kind as "photo" | "video" | "interview", {
    signal: ctx.signal,
  });

  const stored = await writeThumbnail(ctx, row.id, output);
  await ctx.log.info(
    `${(stored.byteSize / 1e3).toFixed(0)} KB thumbnail from ` +
      `${(bytes.byteLength / 1e6).toFixed(1)} MB of ${row.kind}`,
  );
  return stored.etag;
};

/**
 * Store one and point the row at it.
 *
 * Shared with ingest, which makes its thumbnail from the file it already has
 * on disk. One writer, so the key, the content type and the ordering cannot
 * drift between the two callers.
 *
 * The object is written before the row points at it, the ordering every stage
 * here uses: an object nobody references can be swept, while a row pointing at
 * nothing is a broken picture on somebody's hub.
 */
export const writeThumbnail = async (
  ctx: Pick<StageContext, "db" | "store" | "projectId">,
  assetId: string,
  localPath: string,
): Promise<{ byteSize: number; etag: string | null }> => {
  const key = objectKey({
    projectId: ctx.projectId,
    kind: "still",
    assetId,
    name: "thumb.jpg",
  });

  const { size } = await stat(localPath);
  const stored = await ctx.store.put(key, createReadStream(localPath), {
    contentType: "image/jpeg",
    contentLength: size,
  });

  await ctx.db.update(assets).set({ thumbnailKey: key }).where(eq(assets.id, assetId));
  return { byteSize: stored.byteSize, etag: stored.etag };
};
