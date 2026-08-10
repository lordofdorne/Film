import type { MusicTrackInfo } from "@film/edl";
import { ffmpeg, probe } from "./ffmpeg.js";

/**
 * The bed is normalised to this at build time. musicGainDb in the template is
 * then an offset from a known baseline rather than a guess about how hot the
 * source happened to be — the same reason speech clips are normalised at
 * ingest. Without it, swapping one track for another silently changes the mix.
 */
export const BED_TARGET_LUFS = -20;

export type TempBedConfig = {
  readonly trackId: string;
  readonly title: string;
  readonly sourceFile: string;
  readonly cropStartMs: number;
  readonly cropEndMs: number;
  readonly crossfadeMs: number;
  readonly targetDurationMs: number;
};

/**
 * Crop a section out of a source recording and loop it into a bed long enough
 * to sit under a whole film.
 *
 * Butt-joining a loop clicks: the waveform jumps discontinuously at the seam
 * and the ear hears it as a tick every repetition. Each repeat is therefore
 * crossfaded into the next, which costs one crossfade of length per join and
 * makes the seam inaudible.
 */
export const buildLoopedBed = async (
  config: TempBedConfig,
  sourcePath: string,
  outputPath: string,
  scratchPath: string,
): Promise<{ durationMs: number; segmentMs: number; repeats: number }> => {
  const segmentMs = config.cropEndMs - config.cropStartMs;
  if (segmentMs < config.crossfadeMs * 2) {
    throw new Error(
      `crop of ${String(segmentMs)}ms is too short for ${String(config.crossfadeMs)}ms crossfades`,
    );
  }

  // Tiny fades at the edges so the crossfades have clean material to work with
  // even if the crop lands mid-transient.
  const edge = 0.05;
  await ffmpeg([
    "-ss", (config.cropStartMs / 1000).toFixed(3),
    "-to", (config.cropEndMs / 1000).toFixed(3),
    "-i", sourcePath,
    "-af",
    `afade=t=in:st=0:d=${edge.toFixed(2)},` +
      `afade=t=out:st=${(segmentMs / 1000 - edge).toFixed(3)}:d=${edge.toFixed(2)}`,
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
    scratchPath,
  ]);

  // Each join after the first adds (segment - crossfade) to the total.
  const stride = segmentMs - config.crossfadeMs;
  const repeats = Math.max(
    2,
    Math.ceil((config.targetDurationMs - segmentMs) / stride) + 1,
  );

  const inputs: string[] = [];
  for (let i = 0; i < repeats; i++) inputs.push("-i", scratchPath);

  const d = (config.crossfadeMs / 1000).toFixed(3);
  const chain: string[] = [];
  for (let i = 1; i < repeats; i++) {
    const left = i === 1 ? "[0]" : `[a${String(i - 1)}]`;
    const label = i === repeats - 1 ? "[out]" : `[a${String(i)}]`;
    chain.push(`${left}[${String(i)}]acrossfade=d=${d}:c1=tri:c2=tri${label}`);
  }

  await ffmpeg([
    ...inputs,
    "-filter_complex",
    `${chain.join(";")};[out]loudnorm=I=${String(BED_TARGET_LUFS)}:TP=-2:LRA=11[bed]`,
    "-map", "[bed]",
    "-t", (config.targetDurationMs / 1000).toFixed(3),
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
    outputPath,
  ]);

  const info = await probe(outputPath);
  return { durationMs: info.durationMs, segmentMs, repeats };
};

/**
 * Describe the bed as a track the validator can resolve.
 *
 * `usage: "temp-track"` is the honest label: a real recording, standing in
 * while the edit is judged, and refused by the validator anywhere the caller
 * has not explicitly opted into unlicensed music. It is deliberately not
 * marked "licensed", and `available: false` keeps it out of any picker.
 *
 * Cues are inherited from the template's placeholder shape so the film keeps
 * its structure. They are NOT marked against this recording's musical
 * structure — doing that properly is part of commissioning real tracks.
 */
export const describeTempTrack = (
  config: TempBedConfig,
  durationMs: number,
): MusicTrackInfo & { readonly title: string } => ({
  id: config.trackId,
  title: config.title,
  durationMs,
  // No measured downbeats. Compose does not snap picture to beats yet, and an
  // invented grid would be worse than an absent one.
  beatGridMs: [],
  cues: {
    openingMs: 0,
    titleMs: 9_000,
    lifts: [56_000, 80_000, 141_000],
    resolutionMs: 169_000,
    endingMs: 192_000,
  },
  licenseRef: "TEMP TRACK — not licensed, local proof-of-concept renders only",
  usage: "temp-track",
  available: false,
});
