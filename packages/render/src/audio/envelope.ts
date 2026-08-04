/**
 * The music envelope, computed deterministically from speech-segment
 * boundaries and nothing else.
 *
 * No live analysis, no reading the audio, no Date.now(). The same function
 * runs in <Player> and in the server render, so preview and delivery duck
 * identically — the only difference between them is final loudness mastering,
 * which happens in FFmpeg afterwards.
 */
export type EnvelopeConfig = {
  readonly musicGainDb: number;
  readonly duckDb: number;
  /** Music starts ducking this far BEFORE speech, so it is already out of the
   *  way by the first syllable rather than lurching down under it. */
  readonly attackMs: number;
  /** And recovers this slowly afterwards. */
  readonly releaseMs: number;
  readonly fadeInMs: number;
  readonly fadeOutMs: number;
  readonly totalDurationMs: number;
};

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/** Smoothstep, so the envelope has no audible corners. */
const ease = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * How ducked the music is at `ms`, from 0 (open) to 1 (fully under speech).
 * Overlapping influences take the maximum, so back-to-back answers never let
 * the bed swell up between them.
 */
export const duckAmountAt = (
  ms: number,
  speech: ReadonlyArray<readonly [number, number]>,
  attackMs: number,
  releaseMs: number,
): number => {
  let amount = 0;
  for (const [start, end] of speech) {
    if (ms >= start && ms <= end) {
      amount = 1;
      break;
    }
    if (attackMs > 0 && ms < start && ms >= start - attackMs) {
      amount = Math.max(amount, ease((ms - (start - attackMs)) / attackMs));
    }
    if (releaseMs > 0 && ms > end && ms <= end + releaseMs) {
      amount = Math.max(amount, ease(1 - (ms - end) / releaseMs));
    }
  }
  return amount;
};

/** Decibels at `ms`, including head and tail fades. */
export const musicGainDbAt = (
  ms: number,
  speech: ReadonlyArray<readonly [number, number]>,
  config: EnvelopeConfig,
): number => {
  const duck = duckAmountAt(ms, speech, config.attackMs, config.releaseMs);
  const base = config.musicGainDb + config.duckDb * duck;

  const fadeIn = config.fadeInMs > 0 ? ease(ms / config.fadeInMs) : 1;
  const tailStart = config.totalDurationMs - config.fadeOutMs;
  const fadeOut =
    config.fadeOutMs > 0 && ms > tailStart
      ? ease(1 - (ms - tailStart) / config.fadeOutMs)
      : 1;

  const fade = Math.min(fadeIn, fadeOut);
  // Fades act on amplitude, so convert once at the end rather than mixing
  // decibel and linear arithmetic.
  return base + amplitudeToDb(fade);
};

export const dbToAmplitude = (db: number): number =>
  db <= -100 ? 0 : Math.pow(10, db / 20);

export const amplitudeToDb = (amplitude: number): number =>
  amplitude <= 0 ? -100 : 20 * Math.log10(amplitude);

/** Linear volume for Remotion's <Audio volume>, at `ms`. */
export const musicVolumeAt = (
  ms: number,
  speech: ReadonlyArray<readonly [number, number]>,
  config: EnvelopeConfig,
): number => dbToAmplitude(musicGainDbAt(ms, speech, config));
