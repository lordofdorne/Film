import { trackTimeAt, type EDL } from "../schema/edl.js";
import type { MusicTrackInfo, ValidationContext } from "./context.js";
import type { IssueCollector } from "./issues.js";

/**
 * Usages that may never reach a customer. Both are legitimate while an edit is
 * being judged and neither is deliverable, so both are allowed only where the
 * caller has explicitly opted in.
 */
const TEST_ONLY_USAGES = new Set(["fixture-only", "temp-track"]);

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

  if (TEST_ONLY_USAGES.has(track.usage)) {
    if (ctx.allowPlaceholderMusic !== true) {
      c.error(
        "MUSIC_TRACK_UNLICENSED",
        "audio.musicTrackId",
        `"${musicTrackId}" has usage "${track.usage}" and may only be used in ` +
          "fixture and test renders, never in anything delivered to a customer",
      );
    }
  } else if (track.licenseRef === null) {
    c.error(
      "MUSIC_TRACK_UNLICENSED",
      "audio.musicTrackId",
      `"${musicTrackId}" has no licence reference and is not cleared for output`,
    );
  }

  const edits = edl.audio.musicEdits ?? [];
  if (edits.length === 0) {
    const needed = musicStartMs + edl.totalDurationMs;
    if (track.durationMs < needed) {
      c.error(
        "MUSIC_TRACK_TOO_SHORT",
        "audio.musicStartMs",
        `track "${musicTrackId}" is ${track.durationMs}ms but the film needs ${needed}ms ` +
          `(${edl.totalDurationMs}ms from offset ${musicStartMs}ms)`,
      );
    }
  } else {
    checkMusicEdits(edl, track, c);
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

/** One frame at 30 fps: the slack every timing rule here allows. */
const FRAME_MS = 34;

/**
 * Music edits must be playable and, on a measured track, musical.
 *
 * Playable: in order, inside the film, each crossfade shorter than the music
 * either side of it, and every stretch of the track it asks for actually in
 * the track. Musical: on a track with a measured beat grid, both sides of
 * every edit land on a downbeat — a cut a beat early is the one music edit
 * everybody hears. A track with no grid (the temp beds) cannot be checked for
 * that and is not.
 */
const checkMusicEdits = (edl: EDL, track: MusicTrackInfo, c: IssueCollector): void => {
  const edits = edl.audio.musicEdits ?? [];
  const total = edl.totalDurationMs;
  const onBeat = (ms: number): boolean =>
    track.beatGridMs.some((b) => Math.abs(b - ms) <= FRAME_MS);

  let previousAt = 0;
  let segmentStartTrack = edl.audio.musicStartMs;
  edits.forEach((edit, i) => {
    const path = `audio.musicEdits[${String(i)}]`;
    const half = edit.crossfadeMs / 2;
    const nextAt = edits[i + 1]?.atMs ?? total;

    if (edit.atMs <= previousAt || edit.atMs >= total) {
      c.error("MUSIC_EDIT_INVALID", path, `edit at ${edit.atMs}ms is not after ${previousAt}ms and inside the film`);
    }
    if (edit.atMs - half < previousAt || edit.atMs + half > nextAt || edit.toMs < half) {
      c.error("MUSIC_EDIT_INVALID", path, `the ${edit.crossfadeMs}ms crossfade does not fit around the edit`);
    }

    // The outgoing stretch must reach the far side of the crossfade.
    const departure = trackTimeAt(edl.audio, edit.atMs - 1) + 1;
    if (segmentStartTrack < 0 || departure + half > track.durationMs) {
      c.error("MUSIC_TRACK_TOO_SHORT", path, `the music before this edit runs past the end of the track`);
    }
    if (track.beatGridMs.length > 0 && (!onBeat(departure) || !onBeat(edit.toMs))) {
      c.error(
        "MUSIC_EDIT_OFF_BEAT",
        path,
        `the edit leaves the track at ${departure}ms and rejoins at ${edit.toMs}ms; both must be downbeats`,
      );
    }
    previousAt = edit.atMs;
    segmentStartTrack = edit.toMs;
  });

  const last = edits[edits.length - 1];
  if (last !== undefined && last.toMs + (total - last.atMs) > track.durationMs) {
    c.error(
      "MUSIC_TRACK_TOO_SHORT",
      `audio.musicEdits[${String(edits.length - 1)}]`,
      `after the last edit the film needs the track to ${last.toMs + (total - last.atMs)}ms, ` +
        `but it is ${track.durationMs}ms`,
    );
  }
};
