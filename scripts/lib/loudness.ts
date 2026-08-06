import { ffmpeg } from "./media.js";

/** Delivery targets. A render outside tolerance fails rather than ships. */
export const TARGET_LUFS = -14;
export const TARGET_TRUE_PEAK_DB = -1;
export const LUFS_TOLERANCE = 1.0;
export const TRUE_PEAK_CEILING = -0.5;

export type LoudnessReport = {
  readonly integratedLufs: number;
  readonly truePeakDb: number;
  readonly lra: number;
  readonly threshold: number;
  readonly targetOffset: number;
};

/**
 * FFmpeg prints the loudnorm JSON to stderr after everything else, so the
 * report is the LAST JSON object in the stream — not the first. Parsing from
 * the front silently picks up unrelated output.
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

export const measureLoudness = async (path: string): Promise<LoudnessReport> =>
  parseLoudnorm(
    await ffmpeg([
      "-i", path,
      "-af",
      `loudnorm=I=${String(TARGET_LUFS)}:TP=${String(TARGET_TRUE_PEAK_DB)}:LRA=11:print_format=json`,
      "-f", "null", "-",
    ]),
  );

/** Two-pass normalisation: the measurement is fed back in, so the correction
 *  is exact rather than an estimate made while streaming. */
export const normaliseLoudness = async (
  input: string,
  output: string,
  measured: LoudnessReport,
): Promise<void> => {
  await ffmpeg([
    "-i", input,
    "-af",
    `loudnorm=I=${String(TARGET_LUFS)}:TP=${String(TARGET_TRUE_PEAK_DB)}:LRA=11` +
      `:measured_I=${measured.integratedLufs.toFixed(2)}` +
      `:measured_TP=${measured.truePeakDb.toFixed(2)}` +
      `:measured_LRA=${measured.lra.toFixed(2)}` +
      `:measured_thresh=${measured.threshold.toFixed(2)}` +
      `:offset=${measured.targetOffset.toFixed(2)}` +
      ":linear=true:print_format=summary",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    output,
  ]);
};
