import { Audio, Sequence, staticFile } from "remotion";
import { assetPath, type FilmProps } from "../props.js";
import { msToFrame, speechWindows } from "../timing/windows.js";

/**
 * The only source of speech in the film.
 *
 * Interview audio never travels through the visual tree — picture segments are
 * silent by construction. That separation is what makes the two guarantees in
 * the audio routing rules true rather than aspirational: a visual crossfade
 * cannot dip a voice, because the voice is not in the visual layer at all, and
 * speech timing is controlled here and nowhere else.
 *
 * Speech clips are loudness-normalised individually at ingest, so no per-clip
 * gain is applied here. Applying one would silently undo that work.
 */
export const SpeechTrack = ({ props }: { readonly props: FilmProps }) => {
  const { fps } = props.format;

  return (
    <>
      {speechWindows(props.edl).map(({ segment, fromFrame, durationInFrames }) => (
        <Sequence
          key={segment.id}
          from={fromFrame}
          durationInFrames={durationInFrames}
          layout="none"
          name={`speech:${segment.id}`}
        >
          <Audio
            src={staticFile(assetPath(props, segment.assetId))}
            trimBefore={msToFrame(segment.sourceInMs, fps)}
            trimAfter={msToFrame(segment.sourceOutMs, fps)}
          />
        </Sequence>
      ))}
    </>
  );
};
