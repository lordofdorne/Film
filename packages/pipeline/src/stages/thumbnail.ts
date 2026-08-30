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

/**
 * Where this recipe's thumbnail lives, recipe number and all.
 *
 * The version is IN THE NAME, and that is what makes bumping the recipe
 * actually do something. The stage skips an asset that already has a
 * thumbnail — otherwise every ingest would be followed by a pointless download
 * — so a bump that changed only the hash would re-dispatch the work and then
 * skip it, leaving the old picture in place and a row claiming success. With
 * the version in the key, "already has one" becomes "already has THIS one",
 * and the check answers correctly on its own.
 *
 * The name alone is not a trigger, and it is worth being exact about that.
 * `THUMBNAIL_RECIPE` is in the input hash as well, and the hash is what a
 * succeeded `stage_executions` row is keyed by — so it is the bump that lets
 * the work run at all, and the name that stops it being skipped once it does.
 * Editing the name without the number gets neither: verified against real rows,
 * where a re-enqueued job was refused at claim time and did nothing, which is
 * exactly-once behaving correctly. Change both, or change neither.
 *
 * The superseded object is left behind. It is tens of kilobytes, it is inside
 * the project's prefix, and a deletion request takes the whole prefix.
 */
export const thumbnailKeyOf = (projectId: string, assetId: string): string =>
  objectKey({
    projectId,
    kind: "still",
    assetId,
    name: `thumb-v${String(THUMBNAIL_RECIPE)}.jpg`,
  });

/**
 * How long a browser may keep one.
 *
 * Fifteen minutes, matching the longest a signed URL can live. Longer would be
 * pointless rather than wrong: the URL rotates at every window boundary, and a
 * new URL is a new cache entry however patient the old one was.
 *
 * `private` because this is a frame of somebody's grandmother. It may sit in
 * that person's browser and nowhere else — not in a proxy, not in a CDN.
 * `immutable` because the bytes under a given key never change; the version in
 * the name is what changes.
 */
export const THUMBNAIL_CACHE_CONTROL = "private, max-age=900, immutable";

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

/**
 * Whether this asset is missing THIS RECIPE'S thumbnail.
 *
 * One predicate, used by the dispatcher, the backfill and the stage itself,
 * because a "do I need to do this?" answered two ways is a mechanism that only
 * appears to work. Found exactly that way: the stage compared keys, so it was
 * willing to replace an older recipe's picture, while the dispatcher only
 * checked the column for null — so it never asked, and a recipe bump would
 * have quietly changed nothing at all.
 */
export const needsThumbnail = (row: AssetRow): boolean =>
  hasPicture(row) && row.thumbnailKey !== thumbnailKeyOf(row.projectId, row.id);

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

  if (!needsThumbnail(row as AssetRow)) {
    await ctx.log.info("ingest already made this one while it had the file — left alone");
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
  const key = thumbnailKeyOf(ctx.projectId, assetId);

  const { size } = await stat(localPath);
  const stored = await ctx.store.put(key, createReadStream(localPath), {
    contentType: "image/jpeg",
    contentLength: size,
    // Without this the browser applies heuristic caching, which for an object
    // written minutes ago is none at all — and a stable URL with nothing
    // allowed to keep it is a round trip saved on paper and nowhere else.
    cacheControl: THUMBNAIL_CACHE_CONTROL,
  });

  await ctx.db.update(assets).set({ thumbnailKey: key }).where(eq(assets.id, assetId));
  return { byteSize: stored.byteSize, etag: stored.etag };
};
