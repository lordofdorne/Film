import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { assets, hashInputs, type Db, type StageIdentity } from "@film/db";
import { getFormat, type Format } from "@film/formats";
import { getTemplate } from "@film/templates";
import { objectKey } from "@film/storage";

import { detectSpeechRuns, probe, ffmpeg, type MediaInfo } from "../media/ffmpeg.js";
import { buildLoopedBed, describeTempTrack } from "../media/musicBed.js";
import { permanent } from "../runtime/errors.js";
import type { StageContext } from "../runtime/runStage.js";
import {
  isMusicBed,
  normalisedName,
  parseProjectConfig,
  type AssetQcMetrics,
  type AssetRow,
  type AssetWarning,
} from "../model.js";
import { loadProject } from "./context.js";

/**
 * The ingest recipe's version.
 *
 * Part of the input hash, so changing how media is normalised invalidates
 * every cached ingest rather than leaving old output silently in place. Bump
 * it whenever the FFmpeg arguments below change in a way that alters output.
 */
export const INGEST_RECIPE = 1;

/** A take, a photograph or a bed is at most this big before it is a problem. */
const SCRATCH_HEADROOM_BYTES = 4 * 1024 * 1024 * 1024;

export const ingestRequiresFreeBytes = (): number => SCRATCH_HEADROOM_BYTES;

export const ingestIdentity = (row: AssetRow, format: Format): StageIdentity => ({
  projectId: row.projectId,
  assetId: row.id,
  stage: "ingest",
  inputHash: hashInputs({
    storageKey: row.storageKey,
    byteSize: row.byteSize ?? 0,
    kind: row.kind,
    formatId: format.id,
    fps: format.fps,
    recipe: INGEST_RECIPE,
  }),
});

const lowResolutionWarning = (info: MediaInfo, format: Format): AssetWarning | null => {
  if (info.height >= format.height) return null;
  const ratio = (format.height / info.height).toFixed(2);
  return {
    code: "LOW_RESOLUTION",
    message:
      `Recorded at ${String(info.width)}×${String(info.height)}, below the ` +
      `${String(format.width)}×${String(format.height)} film. It is enlarged about ${ratio}× ` +
      "and will look a little soft. Re-recording on a phone would sharpen it.",
  };
};

/**
 * Make one piece of media consistent, and measure it.
 *
 * The customer's original is never touched. Everything here writes a new
 * object under the `normalised` prefix and records the key, so a normalisation
 * recipe that turns out to be wrong is re-runnable against a source that still
 * exists — which is the whole reason the two keys are separate.
 */
export const runIngest = async (ctx: StageContext): Promise<string | null> => {
  if (ctx.assetId === null) throw permanent("ingest was dispatched without an asset");

  const rows = await ctx.db.select().from(assets).where(eq(assets.id, ctx.assetId)).limit(1);
  const row = rows[0];
  if (row === undefined) throw permanent(`asset ${ctx.assetId} no longer exists`);

  const project = await loadProject(ctx.db, ctx.projectId);
  const template = getTemplate(project.templateId, project.templateVersion);
  const format = getFormat(template.defaultFormatId);

  const dir = await ctx.scratch();
  const source = join(dir, "source");
  const output = join(dir, normalisedName(row));

  const bytes = await ctx.store.get(row.storageKey);
  await writeFile(source, bytes);
  await ctx.log.info(`fetched ${(bytes.byteLength / 1e6).toFixed(1)} MB from ${row.storageKey}`);

  const { qc, warnings } = isMusicBed(row)
    ? await ingestMusicBed(ctx, row, source, output)
    : row.kind === "photo"
      ? await ingestPhoto(ctx, source, output, format)
      : row.kind === "audio"
        ? await ingestPromptAudio(ctx, source, output)
        : await ingestFootage(ctx, source, output, format);

  const key = objectKey({
    projectId: ctx.projectId,
    kind: "normalised",
    assetId: row.id,
    name: normalisedName(row),
  });
  // Streamed for the same reason as the render: a normalised interview is
  // hundreds of megabytes, and ingest runs several at once.
  const { size } = await stat(output);
  const stored = await ctx.store.put(key, createReadStream(output), {
    contentType: row.kind === "photo" ? "image/jpeg" : row.kind === "audio" ? "audio/wav" : "video/mp4",
    contentLength: size,
  });

  await ctx.db
    .update(assets)
    .set({ normalisedKey: key, qcMetrics: qc, warnings })
    .where(eq(assets.id, row.id));

  for (const warning of warnings) await ctx.log.warn(`${warning.code}: ${warning.message}`);
  await ctx.log.info(`wrote ${key} (${(stored.byteSize / 1e6).toFixed(1)} MB)`);

  return stored.etag;
};

type IngestResult = { qc: AssetQcMetrics; warnings: AssetWarning[] };

/**
 * An interview take or a b-roll clip.
 *
 * Constant frame rate, even dimensions, faststart, rotation baked into the
 * pixels, and per-clip loudness normalisation to -16 LUFS. That last one is
 * load-bearing: SpeechTrack applies no gain because the brief says clips are
 * normalised at ingest, so without it, answers recorded at different distances
 * from the microphone jump in level between beats.
 */
const ingestFootage = async (
  ctx: StageContext,
  source: string,
  output: string,
  format: Format,
): Promise<IngestResult> => {
  await ffmpeg(
    [
      "-i", source,
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-r", String(format.fps),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      output,
    ],
    { signal: ctx.signal },
  );

  const info = await probe(output, { signal: ctx.signal });
  if (info.durationMs === 0) throw permanent("the file decoded to zero duration");

  /**
   * Speech is measured on the ORIGINAL take, not the normalised one.
   *
   * Loudness normalisation lifts everything, room tone included, so a gate
   * that correctly reads a quiet room as silence beforehand reads it as speech
   * afterwards. Measured: every clip came back speaking from the first frame
   * to the last, which erased the quiet ends the subject was asked to leave
   * and left nothing to hold a question card on. Normalisation does not move
   * anything in time, so boundaries found on the source are valid for the
   * output.
   */
  const runs = (await detectSpeechRuns(source, { signal: ctx.signal })).map((r) => ({
    startMs: Math.min(r.startMs, info.durationMs),
    endMs: Math.min(r.endMs, info.durationMs),
  }));

  const speaking = runs.reduce((n, r) => n + (r.endMs - r.startMs), 0);
  await ctx.log.info(
    `${String(info.width)}x${String(info.height)} ${(info.durationMs / 1000).toFixed(1)}s take, ` +
      `${(speaking / 1000).toFixed(1)}s speech in ${String(runs.length)} run(s)`,
  );

  const warning = lowResolutionWarning(info, format);
  return {
    qc: { width: info.width, height: info.height, durationMs: info.durationMs, speechRuns: runs },
    warnings: warning === null ? [] : [warning],
  };
};

/** EXIF orientation applied physically and the tag dropped, so nothing
 *  downstream has to remember to honour it. */
const ingestPhoto = async (
  ctx: StageContext,
  source: string,
  output: string,
  format: Format,
): Promise<IngestResult> => {
  await ffmpeg(
    ["-i", source, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-q:v", "2", output],
    { signal: ctx.signal },
  );
  const info = await probe(output, { signal: ctx.signal });
  if (info.width === 0) throw permanent("the file has no decodable image");

  // A warning, never a blocker: an undersized still is enlarged, not refused.
  // Whether that matters is the customer's call, not ours.
  const warning = lowResolutionWarning(info, format);
  return {
    qc: { width: info.width, height: info.height },
    warnings: warning === null ? [] : [warning],
  };
};

/** An interviewer's question, recorded as audio and normalised to match speech. */
const ingestPromptAudio = async (
  ctx: StageContext,
  source: string,
  output: string,
): Promise<IngestResult> => {
  await ffmpeg(
    [
      "-i", source,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
      output,
    ],
    { signal: ctx.signal },
  );
  const info = await probe(output, { signal: ctx.signal });
  if (info.durationMs === 0) throw permanent("the recording decoded to zero duration");
  return { qc: { durationMs: info.durationMs }, warnings: [] };
};

/**
 * Crop a section out of the supplied recording and loop it into a bed.
 *
 * Built to a fixed target length from the project's config rather than to the
 * film's length, which is not known until compose has run. A bed longer than
 * the film costs nothing — the renderer stops at the end of the picture — and
 * the alternative is compose doing media work and the two stages depending on
 * each other in a circle.
 */
const ingestMusicBed = async (
  ctx: StageContext,
  row: AssetRow,
  source: string,
  output: string,
): Promise<IngestResult> => {
  const project = await loadProject(ctx.db, row.projectId);
  const bed = parseProjectConfig(project.config).music;
  if (bed === undefined) {
    throw permanent("a music bed asset was supplied but the project has no music config");
  }

  const built = await buildLoopedBed(
    { ...bed, sourceFile: row.storageKey },
    source,
    output,
    join(await ctx.scratch(), "segment.wav"),
  );

  await ctx.log.info(
    `bed "${bed.title}": ${(built.segmentMs / 1000).toFixed(1)}s crop ` +
      `x${String(built.repeats)} crossfaded to ${(built.durationMs / 1000).toFixed(1)}s`,
  );

  return {
    qc: {
      durationMs: built.durationMs,
      musicTrack: describeTempTrack({ ...bed, sourceFile: row.storageKey }, built.durationMs),
      bed: { ...bed, sourceFile: row.storageKey },
    },
    warnings: [],
  };
};

/** Convenience for a caller that has a Db and an asset id and nothing else. */
export const assetRow = async (db: Db, assetId: string): Promise<AssetRow> => {
  const rows = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  const row = rows[0];
  if (row === undefined) throw permanent(`asset ${assetId} no longer exists`);
  return row;
};
