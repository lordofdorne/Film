import { Audio, Sequence } from "remotion";
import { resolveSrc } from "../assets/resolveSrc.js";
import type { FilmProps } from "../props.js";
import { msToFrame, spokenIntervals } from "../timing/windows.js";
import { musicVolumeAt, type EnvelopeConfig } from "./envelope.js";
import { crossfadeGainAt, musicPiecesOf } from "./musicPieces.js";

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
  const intervals = spokenIntervals(edl);

  const config: EnvelopeConfig = {
    musicGainDb: props.audio.musicGainDb ?? edl.audio.musicGainDb,
    duckDb: props.audio.duckDb ?? edl.audio.duckDb,
    attackMs: props.audio.duckAttackMs,
    releaseMs: props.audio.duckReleaseMs,
    fadeInMs: props.audio.fadeInMs,
    fadeOutMs: props.audio.fadeOutMs,
    totalDurationMs: edl.totalDurationMs,
  };

  /**
   * One piece of track per stretch between music edits (`musicPiecesOf`);
   * without edits, one piece, exactly as the bed always was. The ducking
   * envelope is a function of FILM time, so it carries on across an edit as
   * if nothing had happened — only the crossfade gain knows there is one.
   */
  const pieces = musicPiecesOf(edl.audio, edl.totalDurationMs);
  if (pieces.length === 1) {
    return (
      <Audio
        src={resolveSrc(props.musicPath)}
        trimBefore={msToFrame(edl.audio.musicStartMs, format.fps)}
        volume={(frame) => musicVolumeAt((frame / format.fps) * 1000, intervals, config)}
      />
    );
  }

  return (
    <>
      {pieces.map((piece, i) => {
        const from = msToFrame(piece.fromMs, format.fps);
        return (
          <Sequence
            key={i}
            from={from}
            durationInFrames={Math.max(1, msToFrame(piece.toMs, format.fps) - from)}
            layout="none"
            name={`music:${String(i)}`}
          >
            <Audio
              src={resolveSrc(props.musicPath)}
              trimBefore={msToFrame(piece.trackFromMs, format.fps)}
              volume={(frame) => {
                const ms = ((from + frame) / format.fps) * 1000;
                return musicVolumeAt(ms, intervals, config) * crossfadeGainAt(piece, ms);
              }}
            />
          </Sequence>
        );
      })}
    </>
  );
};
