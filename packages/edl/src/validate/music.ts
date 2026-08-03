import type { EDL } from "../schema/edl.js";
import type { MusicTrackInfo, ValidationContext } from "./context.js";
import type { IssueCollector } from "./issues.js";

/** Nothing marked creative-reference-only may ever reach a render. */
const REFERENCE_ONLY = "creative-reference-only";
const PLACEHOLDER = "fixture-only";

export const checkMusic = (
  edl: EDL,
  ctx: ValidationContext,
  c: IssueCollector,
): void => {
  const { musicTrackId, musicStartMs, beatGridMs } = edl.audio;
  const track: MusicTrackInfo | undefined = ctx.resolveMusicTrack(musicTrackId);

  if (track === undefined) {
    c.error(
      "MUSIC_TRACK_UNRESOLVED",
      "audio.musicTrackId",
      `"${musicTrackId}" does not resolve to a registry entry`,
    );
    return;
  }

  if (track.usage === REFERENCE_ONLY || track.licenseRef === null) {
    c.error(
      "MUSIC_TRACK_UNLICENSED",
      "audio.musicTrackId",
      `"${musicTrackId}" is not licensed for output (usage "${track.usage}")`,
    );
  } else if (track.usage === PLACEHOLDER && ctx.allowPlaceholderMusic !== true) {
    c.error(
      "MUSIC_TRACK_UNLICENSED",
      "audio.musicTrackId",
      `"${musicTrackId}" is placeholder music and may only be used in fixture ` +
        "and test contexts",
    );
  }

  const needed = musicStartMs + edl.totalDurationMs;
  if (track.durationMs < needed) {
    c.error(
      "MUSIC_TRACK_TOO_SHORT",
      "audio.musicStartMs",
      `track "${musicTrackId}" is ${track.durationMs}ms but the film needs ${needed}ms ` +
        `(${edl.totalDurationMs}ms from offset ${musicStartMs}ms)`,
    );
  }

  const cues: ReadonlyArray<readonly [string, number]> = [
    ["openingMs", track.cues.openingMs],
    ["titleMs", track.cues.titleMs],
    ["resolutionMs", track.cues.resolutionMs],
    ["endingMs", track.cues.endingMs],
    ...track.cues.lifts.map((v, i) => [`lifts[${i}]`, v] as const),
  ];
  for (const [name, value] of cues) {
    if (value < 0 || value > track.durationMs) {
      c.error(
        "MUSIC_CUE_OUTSIDE_TRACK",
        "audio.musicTrackId",
        `cue ${name} at ${value}ms lies outside track "${musicTrackId}" (${track.durationMs}ms)`,
      );
    }
  }

  // The EDL carries a frozen copy of the grid so a re-render years later is
  // reproducible. If it no longer matches the registry, something mutated a
  // track that a project already depends on — which the registry rules forbid.
  const known = new Set(track.beatGridMs);
  for (let i = 0; i < beatGridMs.length; i++) {
    const b = beatGridMs[i];
    if (b === undefined) continue;
    const prev = beatGridMs[i - 1];
    if (prev !== undefined && b <= prev) {
      c.error(
        "BEAT_GRID_DIVERGENCE",
        `audio.beatGridMs[${i}]`,
        `${b}ms does not strictly follow ${prev}ms`,
      );
      break;
    }
    if (!known.has(b)) {
      c.error(
        "BEAT_GRID_DIVERGENCE",
        `audio.beatGridMs[${i}]`,
        `${b}ms is not a downbeat of track "${musicTrackId}"; the registry entry ` +
          "has changed since this EDL was written",
      );
      break;
    }
  }
};
