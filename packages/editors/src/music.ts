import type { ComposeInput } from "./material.js";

/**
 * Making the music end with the film.
 *
 * The track starts with the film, so its title cue lands on the main title —
 * that is already arranged. What was not: the track has an ENDING, a place it
 * resolves, and the film ended wherever the answers ran out, with the music
 * faded mid-phrase. Life-advice films range from two minutes to four, and a
 * track has one length.
 *
 * The fix is the one a film's music editor makes by hand: one edit in the
 * middle, on a downbeat, crossfaded. Skip forward when the film is shorter
 * than the music, go back and repeat when it is longer — so the ending cue
 * lands on the moment the editor says the film ends. The edit cannot be
 * finer than the bar lines allow, so what is left over (under a bar) goes to
 * a hold the editor can stretch or shorten: the picture waits for the music,
 * not the other way round.
 *
 * Only for a track with a measured beat grid and a marked ending — a
 * commissioned track. The temp beds are loops with neither, and are left to
 * play and fade exactly as before.
 */

/** Track time and film time agree until the edit; it goes after this much music. */
const AFTER_TITLE_MS = 8_000;
/** A crossfade at a downbeat: long enough not to click, short enough not to smear. */
const CROSSFADE_MS = 400;

export type MusicFit = {
  readonly edits: readonly { readonly atMs: number; readonly toMs: number; readonly crossfadeMs: number }[];
  /** Add to the stretchable hold so the ending cue lands on the film's end. */
  readonly holdAdjustMs: number;
  readonly note?: string;
};

const NONE: MusicFit = { edits: [], holdAdjustMs: 0 };

const nearest = (grid: readonly number[], ms: number): number =>
  grid.reduce((best, b) => (Math.abs(b - ms) < Math.abs(best - ms) ? b : best), grid[0] ?? 0);

/**
 * The edit, if any, that puts the track's ending cue at film time `endAtMs`.
 *
 * `endAtMs` is where the film's ending moment falls with the hold at its
 * natural length; `hold` is how far that hold may stretch or shrink; and
 * `filmEndMs` is the whole film, which the track must outlast after the edit.
 */
export const fitMusic = (
  track: ComposeInput["track"],
  endAtMs: number,
  filmEndMs: number,
  hold: { readonly shortenBy: number; readonly lengthenBy: number },
): MusicFit => {
  const grid = track.beatGridMs;
  const endingMs = track.cues.endingMs;
  const durationMs = track.durationMs;
  if (grid.length < 2 || endingMs === undefined || durationMs === undefined) return NONE;

  // The jump that would land the ending exactly: positive skips, negative repeats.
  const wanted = endingMs - endAtMs;
  const fits = (adjust: number): boolean => adjust >= -hold.shortenBy && adjust <= hold.lengthenBy;

  // Close enough already: the hold absorbs it and the music plays straight through.
  if (fits(wanted)) {
    return { edits: [], holdAdjustMs: wanted, note: "the music ends with the film without an edit" };
  }

  // The edit point: a downbeat in the middle of the music between the title and
  // the resolution, where a bar more or less is least noticed.
  const earliest = track.cues.titleMs + AFTER_TITLE_MS;
  const latest = Math.min(track.cues.resolutionMs ?? endingMs, endAtMs) - AFTER_TITLE_MS;
  if (latest <= earliest) return NONE;
  const candidates = grid.filter((b) => b >= earliest && b <= latest);
  const middle = (earliest + latest) / 2;
  candidates.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));

  for (const atMs of candidates) {
    const toMs = nearest(grid, atMs + wanted);
    const leftover = wanted - (toMs - atMs);
    const afterEdit = toMs + (filmEndMs + leftover - atMs);
    if (toMs < track.cues.titleMs || toMs > endingMs || afterEdit > durationMs || !fits(leftover)) continue;
    const seconds = Math.round(Math.abs(toMs - atMs) / 1000);
    return {
      edits: [{ atMs, toMs, crossfadeMs: CROSSFADE_MS }],
      holdAdjustMs: leftover,
      note:
        toMs > atMs
          ? `the music skips ${String(seconds)} s at ${String(Math.round(atMs / 1000))} s so it ends with the film`
          : `the music repeats ${String(seconds)} s at ${String(Math.round(atMs / 1000))} s so it ends with the film`,
    };
  }
  return { ...NONE, note: "no music edit could make the ending land; the music fades with the film" };
};
