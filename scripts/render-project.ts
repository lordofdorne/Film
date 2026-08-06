/**
 * Renders a composed project — real media or fixture — offline.
 *
 *   pnpm film:real            renders project/real
 *   tsx scripts/render-project.ts <dir>
 *
 * The composition is the same one the fixture uses; only the media and the
 * EDL differ. Props are passed as inputProps and the composition's dimensions
 * and length are derived from them by calculateMetadata, so nothing about the
 * fixture leaks into a real render.
 */
import { readFile, mkdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { buildFilmProps } from "@film/render/project";

import { measureLoudness, normaliseLoudness, TARGET_LUFS, TRUE_PEAK_CEILING, LUFS_TOLERANCE } from "./lib/loudness.js";
import { webpackOverride } from "./webpack-override.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = join(ROOT, "packages/render/src/entry.ts");

const step = (m: string): void => {
  process.stdout.write(`\n\x1b[1m${m}\x1b[0m\n`);
};
const note = (m: string): void => {
  process.stdout.write(`  ${m}\n`);
};

const main = async (): Promise<void> => {
  const started = Date.now();
  const projectDir = resolve(ROOT, process.argv[2] ?? "project/real");
  const name = basename(projectDir);
  const media = join(projectDir, "media");
  const outDir = join(ROOT, "out");
  await mkdir(outDir, { recursive: true });

  const mezzanine = join(outDir, `${name}-mezzanine.mp4`);
  const delivery = join(outDir, `life-advice-${name}.mp4`);

  step(`1/4  Loading ${name}`);
  const [edl, manifest, subject] = await Promise.all(
    ["edl.json", "manifest.json", "subject.json"].map(async (f) =>
      JSON.parse(await readFile(join(projectDir, f), "utf8")),
    ),
  );

  // Validates the EDL and resolves all template text before anything renders.
  const props = buildFilmProps({ edl, manifest, subject });
  note(
    `${String(props.edl.visualSegments.length)} visual, ` +
      `${String(props.edl.speechSegments.length)} speech, ` +
      `${String(props.edl.promptSegments.length)} prompt segments`,
  );

  step("2/4  Bundling");
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: media, webpackOverride });
  const composition = await selectComposition({
    serveUrl,
    id: "LifeAdvice",
    inputProps: props,
  });
  note(
    `${composition.width}x${composition.height} @ ${String(composition.fps)}fps, ` +
      `${String(composition.durationInFrames)} frames ` +
      `(${(composition.durationInFrames / composition.fps).toFixed(1)}s)`,
  );

  step("3/4  Rendering");
  let reported = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps: props,
    codec: "h264",
    crf: 18,
    outputLocation: mezzanine,
    concurrency: 1,
    chromiumOptions: { gl: "swiftshader" },
    timeoutInMilliseconds: 120_000,
    offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
    onProgress: ({ renderedFrames }) => {
      const pct = Math.floor((renderedFrames / composition.durationInFrames) * 100);
      if (pct >= reported + 20) {
        reported = pct - (pct % 20);
        note(`${String(reported)}%  (${String(renderedFrames)} frames)`);
      }
    },
  });

  step("4/4  Loudness");
  const before = await measureLoudness(mezzanine);
  note(`measured  ${before.integratedLufs.toFixed(2)} LUFS, ${before.truePeakDb.toFixed(2)} dBTP`);
  await rm(delivery, { force: true });
  await normaliseLoudness(mezzanine, delivery, before);
  const after = await measureLoudness(delivery);
  note(`delivered ${after.integratedLufs.toFixed(2)} LUFS, ${after.truePeakDb.toFixed(2)} dBTP`);

  const failures: string[] = [];
  if (Math.abs(after.integratedLufs - TARGET_LUFS) > LUFS_TOLERANCE) {
    failures.push(`integrated loudness ${after.integratedLufs.toFixed(2)} LUFS off target`);
  }
  if (after.truePeakDb > TRUE_PEAK_CEILING) {
    failures.push(`true peak ${after.truePeakDb.toFixed(2)} dBTP over ceiling`);
  }
  if (failures.length > 0) {
    throw new Error(`delivery failed loudness verification:\n  ${failures.join("\n  ")}`);
  }

  const { size } = await stat(delivery);
  step(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s  —  ` +
      `${delivery.replace(ROOT, "")} (${(size / 1_000_000).toFixed(1)} MB)`,
  );
};

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
