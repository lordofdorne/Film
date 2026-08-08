import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { eq } from "drizzle-orm";

import { edlVersions, hashInputs, renders, type StageIdentity } from "@film/db";
import { getFormat } from "@film/formats";
import { buildProjectProps } from "@film/render/props";
import { objectKey } from "@film/storage";
import { getTemplate } from "@film/templates";

import {
  LUFS_TOLERANCE,
  TARGET_LUFS,
  TRUE_PEAK_CEILING,
  measureLoudness,
  normaliseLoudness,
} from "../media/loudness.js";
import { permanent, transient } from "../runtime/errors.js";
import type { StageContext } from "../runtime/runStage.js";
import {
  buildManifest,
  filmAssets,
  isMusicBed,
  normalisedName,
  qcOf,
  type AssetRow,
} from "../model.js";
import { subjectOf } from "./compose.js";
import { loadAssets, loadProject } from "./context.js";
import { webpackOverride } from "../render/webpack.js";

/** Bump when the render pipeline's output changes for identical inputs. */
export const RENDER_RECIPE = 1;

/**
 * Scratch space a render needs: every source clip, a mezzanine and a delivery
 * file. Generous on purpose — a full disk does not fail cleanly. FFmpeg writes
 * a truncated file, the loudness check passes on the fragment it can read, and
 * a broken film reaches a customer.
 */
export const RENDER_REQUIRES_FREE_BYTES = 8 * 1024 * 1024 * 1024;

export type RenderQuality = "preview" | "delivery";

export const renderIdentity = (input: {
  readonly projectId: string;
  readonly renderId: string;
  readonly edlVersionId: string;
  readonly formatId: string;
  readonly quality: RenderQuality;
}): StageIdentity => ({
  projectId: input.projectId,
  assetId: null,
  stage: "render",
  inputHash: hashInputs({
    edlVersionId: input.edlVersionId,
    formatId: input.formatId,
    quality: input.quality,
    recipe: RENDER_RECIPE,
  }),
});

/**
 * Where the Remotion entry point lives.
 *
 * Resolved from the installed @film/render package rather than from a path
 * relative to the repository root, because the worker's working directory in a
 * container is not the repository. Overridable for anyone who pre-bundles.
 */
const entryPoint = (): string => {
  const override = process.env["REMOTION_ENTRY"];
  if (override !== undefined && override !== "") return override;
  const composition = fileURLToPath(import.meta.resolve("@film/render/composition"));
  // dist/composition.js -> src/entry.ts, which is what the bundler wants.
  return join(dirname(dirname(composition)), "src", "entry.ts");
};

/**
 * Render one approved cut to a delivery file.
 *
 * Media is pulled to local disk rather than handed to Chrome as signed URLs.
 * A signed URL is capped at fifteen minutes and a long film outlives that, so
 * the render would fail two thirds of the way through when the URLs expired —
 * and it would fail differently depending on the length of the film, which is
 * the worst kind of bug to be told about by a customer.
 */
export const runRender = async (ctx: StageContext, renderId: string): Promise<string | null> => {
  const started = Date.now();

  const renderRows = await ctx.db.select().from(renders).where(eq(renders.id, renderId)).limit(1);
  const render = renderRows[0];
  if (render === undefined) throw permanent(`render ${renderId} no longer exists`);

  const versionRows = await ctx.db
    .select()
    .from(edlVersions)
    .where(eq(edlVersions.id, render.edlVersionId))
    .limit(1);
  const version = versionRows[0];
  if (version === undefined) throw permanent("the cut this render points at no longer exists");

  const project = await loadProject(ctx.db, ctx.projectId);
  const rows = await loadAssets(ctx.db, ctx.projectId);
  const template = getTemplate(project.templateId, project.templateVersion);
  const format = getFormat(template.defaultFormatId);

  const dir = await ctx.scratch();
  const media = join(dir, "media");

  /* ── pull every asset the film touches to local disk ──────────────── */
  const assetPaths: Record<string, string> = {};
  let musicPath = "";
  let bytes = 0;

  for (const row of rows) {
    if (row.normalisedKey === null) throw transient(`asset ${row.id} has not been ingested`);
    const relative = isMusicBed(row)
      ? `music/${row.id}.wav`
      : `${row.kind}/${row.id}${extensionOf(row)}`;
    const path = join(media, relative);
    await mkdir(dirname(path), { recursive: true });
    const object = await ctx.store.get(row.normalisedKey);
    await writeFile(path, object);
    bytes += object.byteLength;

    if (isMusicBed(row)) musicPath = relative;
    else assetPaths[row.id] = relative;
  }
  if (musicPath === "") throw permanent("the project has no music bed to render against");
  await ctx.log.info(
    `pulled ${String(rows.length)} assets (${(bytes / 1e6).toFixed(0)} MB) to local disk`,
  );

  /* ── props: validated, text resolved, before anything renders ─────── */
  const bedRow = rows.find(isMusicBed);
  const props = buildProjectProps({
    edl: version.doc,
    manifest: buildManifest(rows),
    subject: subjectOf(project),
    templateId: project.templateId,
    templateVersion: project.templateVersion,
    assetPaths,
    musicPath,
    ...(bedRow === undefined ? {} : { musicTrack: qcOf(bedRow).musicTrack }),
    allowPlaceholderMusic: process.env["ALLOW_UNLICENSED_MUSIC"] === "1",
  });

  /* ── bundle, render, verify ───────────────────────────────────────── */
  await ctx.log.info("bundling");
  const serveUrl = await bundle({ entryPoint: entryPoint(), publicDir: media, webpackOverride });

  const composition = await selectComposition({ serveUrl, id: "LifeAdvice", inputProps: props });
  await ctx.log.info(
    `${String(composition.width)}x${String(composition.height)} @ ${String(composition.fps)}fps, ` +
      `${String(composition.durationInFrames)} frames ` +
      `(${(composition.durationInFrames / composition.fps).toFixed(1)}s)`,
  );

  const mezzanine = join(dir, "mezzanine.mp4");
  const delivery = join(dir, "delivery.mp4");

  let reported = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps: props,
    codec: "h264",
    crf: render.quality === "preview" ? 26 : 18,
    outputLocation: mezzanine,
    concurrency: 1,
    chromiumOptions: { gl: "swiftshader" },
    timeoutInMilliseconds: 120_000,
    // Uncapped, ten 1080p sources push Chrome into swap and it stops
    // executing JavaScript — which surfaces as a frame timeout, not as memory
    // pressure, and sends you looking in the wrong place for a day.
    offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
    onProgress: ({ renderedFrames }) => {
      const pct = Math.floor((renderedFrames / composition.durationInFrames) * 100);
      if (pct >= reported + 25) {
        reported = pct - (pct % 25);
        void ctx.log.info(`${String(reported)}% (${String(renderedFrames)} frames)`);
      }
    },
  });

  const before = await measureLoudness(mezzanine, { signal: ctx.signal });
  await rm(delivery, { force: true });
  await normaliseLoudness(mezzanine, delivery, before, { signal: ctx.signal });
  const after = await measureLoudness(delivery, { signal: ctx.signal });
  await ctx.log.info(
    `loudness ${before.integratedLufs.toFixed(2)} -> ${after.integratedLufs.toFixed(2)} LUFS, ` +
      `${after.truePeakDb.toFixed(2)} dBTP`,
  );

  /**
   * Out of tolerance fails the render rather than shipping.
   *
   * A film that is four LU quiet is not a small blemish — it is the one
   * defect every viewer notices and nobody can name, and it is trivially
   * detectable here.
   */
  const failures: string[] = [];
  if (Math.abs(after.integratedLufs - TARGET_LUFS) > LUFS_TOLERANCE) {
    failures.push(`integrated loudness ${after.integratedLufs.toFixed(2)} LUFS off target`);
  }
  if (after.truePeakDb > TRUE_PEAK_CEILING) {
    failures.push(`true peak ${after.truePeakDb.toFixed(2)} dBTP over ceiling`);
  }
  if (failures.length > 0) throw transient(`failed loudness verification: ${failures.join("; ")}`);

  /* ── store it and record where it went ────────────────────────────── */
  const key = objectKey({
    projectId: ctx.projectId,
    kind: "render",
    name: `${render.quality}-${format.id}-v${String(version.version)}.mp4`,
  });
  const stored = await ctx.store.put(key, await readFile(delivery), { contentType: "video/mp4" });

  await ctx.db
    .update(renders)
    .set({ outputKey: key, status: "succeeded", error: null })
    .where(eq(renders.id, renderId));

  const { size } = await stat(delivery);
  await ctx.log.info(
    `${key} — ${(size / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );

  return stored.etag;
};

const extensionOf = (row: AssetRow): string => {
  const name = normalisedName(row);
  return name.slice(name.lastIndexOf("."));
};

/** Assets a render must pull, for a caller sizing its disk check. */
export const renderableAssets = filmAssets;
