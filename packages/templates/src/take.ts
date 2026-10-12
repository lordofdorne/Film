/**
 * How long a recorded take should be, and what to say about the one being made.
 *
 * Each question and video slot in a template declares its own: an identity
 * answer is a sentence, the greatest lesson is a story, a candid moment is ten
 * quiet seconds. The recording screen draws these as a timer with a good range
 * on it, stops the recording at `max`, and after a short take suggests the
 * length that works.
 *
 * Its own entry point (`@film/templates/take`) because the browser needs it
 * while the camera is running, and the package root carries every template's
 * copy with it.
 */

/** Seconds. `goodFrom < goodTo <= max`. */
export type TakeLength = {
  /** Below this, the film has little to work with. */
  readonly goodFrom: number;
  /** Past this, it is plenty: wrap up when it feels right. */
  readonly goodTo: number;
  /** Recording stops here by itself. */
  readonly max: number;
};

/**
 * Where a take is, for the timer and for what is said after it.
 *
 *   short    — not yet in the good range
 *   good     — say "you can stop whenever you're ready"
 *   plenty   — past the good range, still recording
 *   ending   — the last few seconds before it stops by itself
 *   max      — it has stopped by itself
 */
export type TakeZone = "short" | "good" | "plenty" | "ending" | "max";

/** How long before `max` the timer starts counting down out loud. */
export const ENDING_WARNING_SECONDS = 15;

export const takeZone = (seconds: number, length: TakeLength): TakeZone => {
  if (seconds >= length.max) return "max";
  if (seconds >= length.max - ENDING_WARNING_SECONDS && seconds >= length.goodTo) return "ending";
  if (seconds >= length.goodTo) return "plenty";
  if (seconds >= length.goodFrom) return "good";
  return "short";
};

/** The template's ranges make sense, or the template is broken. */
export const validTakeLength = (length: TakeLength): boolean =>
  Number.isFinite(length.goodFrom) &&
  length.goodFrom > 0 &&
  length.goodFrom < length.goodTo &&
  length.goodTo <= length.max;

/** "0:45", "1:30": the way the timer says it. */
export const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
};

/** "30 seconds to a minute and a half": the way a sentence says it. */
export const spokenRange = (length: TakeLength): string =>
  length.goodTo < 60
    ? `${String(length.goodFrom)} to ${String(length.goodTo)} seconds`
    : `${spoken(length.goodFrom)} to ${spoken(length.goodTo)}`;

const spoken = (seconds: number): string => {
  if (seconds < 60) return `${String(seconds)} seconds`;
  const minutes = seconds / 60;
  if (minutes === 1) return "a minute";
  if (minutes === 1.5) return "a minute and a half";
  if (Number.isInteger(minutes)) return `${String(minutes)} minutes`;
  return clock(seconds);
};
