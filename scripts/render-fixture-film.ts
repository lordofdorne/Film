/**
 * Renders the complete fixture film locally, offline, in one command.
 *
 *   pnpm film
 *
 * No R2, no Stripe, no Anthropic, no transcription API, no network call of any
 * kind. This must stay true for the life of the project — it is the harness
 * that keeps the render path testable.
 *
 *   generate fixtures (if missing)
 *     -> validate EDL
 *     -> Remotion render                 -> out/mezzanine.mp4
 *     -> FFmpeg loudness analysis
 *     -> FFmpeg normalisation            -> out/life-advice-fixture.mp4
 *     -> FFmpeg verification             (fails the render if out of tolerance)
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import { withoutMusicDuck } from "../packages/render/src/fixture.js";
import type { FilmProps } from "../packages/render/src/props.js";
import { generateFixtures } from "./generate-fixtures.js";
import { webpackOverride } from "./webpack-override.js";

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = join(ROOT, "fixtures");
const OUT = join(ROOT, "out");
const ENTRY = join(ROOT, "packages/render/src/entry.ts");

const MEZZANINE = join(OUT, "mezzanine.mp4");
const DELIVERY = join(OUT, "life-advice-fixture.mp4");

/** Delivery targets. A render outside tolerance fails rather than ships. */
const TARGET_LUFS = -14;
const TARGET_TRUE_PEAK_DB = -1;
const LUFS_TOLERANCE = 1.0;
const TRUE_PEAK_CEILING = -0.5;

const step = (message: string): void => {
  process.stdout.write(`\n[1m${message}[0m\n`);
};
const note = (message: string): void => {
  process.stdout.write(`  ${message}\n`);
};

const ffmpeg = async (args: readonly string[]): Promise<string> => {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostdin", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stderr;
};

type LoudnessReport = {
  readonly integratedLufs: number;
  readonly truePeakDb: number;
  readonly lra: number;
  readonly threshold: number;
  readonly targetOffset: number;
};

/**
 * FFmpeg prints the loudnorm JSON to stderr after everything else, so the
 * report is the LAST JSON object in the stream — not the first.
 */
const parseLoudnorm = (stderr: string): LoudnessReport => {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`could not find loudnorm JSON in ffmpeg output:\n${stderr.slice(-2000)}`);
  }
  const raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  const num = (key: string): number => {
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`loudnorm reported a non-finite ${key}: ${String(raw[key])}`);
    }
    return value;
  };
  return {
    integratedLufs: num("input_i"),
    truePeakDb: num("input_tp"),
    lra: num("input_lra"),
    threshold: num("input_thresh"),
    targetOffset: num("target_offset"),
  };
};

const measure = async (path: string): Promise<LoudnessReport> => {
  const stderr = await ffmpeg([
    "-i", path,
    "-af",
    `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DB}:LRA=11:print_format=json`,
    "-f", "null", "-",
  ]);
  return parseLoudnorm(stderr);
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const main = async (): Promise<void> => {
  const started = Date.now();
  await mkdir(OUT, { recursive: true });

  step("1/5  Fixture media");
  await generateFixtures();

  step("2/5  Bundling composition");
  // publicDir points at the generated fixtures, so staticFile() in the
  // composition resolves to real media without proxying anything.
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    publicDir: FIXTURES,
    webpackOverride,
    onProgress: (percent) => {
      if (percent % 25 === 0) note(`webpack ${String(percent)}%`);
    },
  });
  note("bundled");

  step("3/5  Rendering mezzanine");
  // The EDL is validated inside buildFixtureProps at module load, so reaching
  // this point already means the document passed every invariant.

  // Silent interview audio (reference-music mode) has nothing for the bed to
  // duck under � leave music up so loudnorm can hit -14 LUFS.
  let inputProps: FilmProps | undefined;
  try {
    const mode = (await readFile(join(FIXTURES, "interview", ".speech-mode"), "utf8")).trim();
    if (mode === "silent") {
      const defaults = (
        await selectComposition({ serveUrl, id: "LifeAdvice" })
      ).props as FilmProps;
      inputProps = withoutMusicDuck(defaults);
      note("speech mode silent - music ducking disabled for this render");
    }
  } catch {
    /* marker absent: keep authored ducking */
  }

  const composition = await selectComposition({
    serveUrl,
    id: "LifeAdvice",
    ...(inputProps !== undefined ? { inputProps } : {}),
  });
  note(
    `${composition.width}x${composition.height} @ ${String(composition.fps)}fps, ` +
      `${String(composition.durationInFrames)} frames ` +
      `(${(composition.durationInFrames / composition.fps).toFixed(1)}s)`,
  );

  let lastReported = -1;
  await renderMedia({
    serveUrl,
    composition,
    ...(inputProps !== undefined ? { inputProps } : {}),
    codec: "h264",
    crf: 18,
    outputLocation: MEZZANINE,
    // Concurrency 1 to start, as the render worker will run in production.
    concurrency: 1,
    chromiumOptions: { gl: "swiftshader" },
    // Remotion's default 28s delayRender budget is too tight here: under
    // software GL the font gate and the first video decode compete for a cold
    // page, and the render dies before frame 0. A render worker has no reason
    // to be impatient — a stuck render is caught by the stage timeout instead.
    timeoutInMilliseconds: 120_000,
    // Cap the extracted-frame cache. Left to grow, ten 1080p sources push the
    // Chrome page into swap and it stops executing JavaScript entirely — which
    // surfaces as the module-scope font delayRender never clearing, about a
    // fifth of the way in. The cache is a speed optimisation; the render is
    // sequential and re-decoding is cheap next to dying.
    offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
    onProgress: ({ renderedFrames }) => {
      const percent = Math.floor((renderedFrames / composition.durationInFrames) * 100);
      if (percent >= lastReported + 10) {
        lastReported = percent - (percent % 10);
        note(`${String(lastReported)}%  (${String(renderedFrames)} frames)`);
      }
    },
  });
  note(`wrote ${MEZZANINE.replace(ROOT, "")}`);

  step("4/5  Loudness normalisation");
  const before = await measure(MEZZANINE);
  note(
    `measured  ${before.integratedLufs.toFixed(2)} LUFS, ` +
      `${before.truePeakDb.toFixed(2)} dBTP, LRA ${before.lra.toFixed(2)}`,
  );

  await rm(DELIVERY, { force: true });
  await ffmpeg([
    "-i", MEZZANINE,
    "-af",
    `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DB}:LRA=11` +
      `:measured_I=${before.integratedLufs.toFixed(2)}` +
      `:measured_TP=${before.truePeakDb.toFixed(2)}` +
      `:measured_LRA=${before.lra.toFixed(2)}` +
      `:measured_thresh=${before.threshold.toFixed(2)}` +
      `:offset=${before.targetOffset.toFixed(2)}` +
      ":linear=true:print_format=summary",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    "-y", DELIVERY,
  ]);
  note(`wrote ${DELIVERY.replace(ROOT, "")}`);

  step("5/5  Verification");
  const after = await measure(DELIVERY);
  note(
    `delivered ${after.integratedLufs.toFixed(2)} LUFS, ` +
      `${after.truePeakDb.toFixed(2)} dBTP, LRA ${after.lra.toFixed(2)}`,
  );

  const failures: string[] = [];
  if (Math.abs(after.integratedLufs - TARGET_LUFS) > LUFS_TOLERANCE) {
    failures.push(
      `integrated loudness ${after.integratedLufs.toFixed(2)} LUFS is more than ` +
        `${LUFS_TOLERANCE.toFixed(1)} from the ${TARGET_LUFS} target`,
    );
  }
  if (after.truePeakDb > TRUE_PEAK_CEILING) {
    failures.push(
      `true peak ${after.truePeakDb.toFixed(2)} dBTP exceeds the ` +
        `${TRUE_PEAK_CEILING} ceiling`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`delivery failed loudness verification:\n  ${failures.join("\n  ")}`);
  }
  note("within tolerance");

  if (!(await exists(DELIVERY))) {
    throw new Error("delivery file is missing after a successful render");
  }
  const { size } = await stat(DELIVERY);

  step(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s  —  ` +
      `${DELIVERY.replace(ROOT, "")} (${(size / 1_000_000).toFixed(1)} MB)`,
  );
};

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
