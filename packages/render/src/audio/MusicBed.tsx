import { Audio, staticFile } from "remotion";
import type { FilmProps } from "../props.js";
import { msToFrame, speechIntervals } from "../timing/windows.js";
import { musicVolumeAt, type EnvelopeConfig } from "./envelope.js";

/**
 * The music bed and its ducking envelope.
 *
 * The envelope is a pure function of speech-segment boundaries evaluated per
 * frame — never live analysis of the audio, never a compressor, never
 * anything that could behave differently in the Player than on the server.
 * Preview and delivery therefore duck identically; the only acoustic
 * difference between them is final loudness mastering, which happens in
 * FFmpeg after Remotion has finished.
 */
export const MusicBed = ({ props }: { readonly props: FilmProps }) => {
  const { edl, format } = props;
  const intervals = speechIntervals(edl);

  const config: EnvelopeConfig = {
    musicGainDb: props.audio.musicGainDb ?? edl.audio.musicGainDb,
    duckDb: props.audio.duckDb ?? edl.audio.duckDb,
    attackMs: props.audio.duckAttackMs,
    releaseMs: props.audio.duckReleaseMs,
    fadeInMs: props.audio.fadeInMs,
    fadeOutMs: props.audio.fadeOutMs,
    totalDurationMs: edl.totalDurationMs,
  };

  return (
    <Audio
      src={staticFile(props.musicPath)}
      trimBefore={msToFrame(edl.audio.musicStartMs, format.fps)}
      volume={(frame) => musicVolumeAt((frame / format.fps) * 1000, intervals, config)}
    />
  );
};
