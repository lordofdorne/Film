import { Audio } from "remotion";
import { resolveSrc } from "../assets/resolveSrc.js";
import { assetPath, type FilmProps } from "../props.js";
import { MediaSequence } from "../timing/MediaSequence.js";
import { msToFrame, speechWindows } from "../timing/windows.js";

/**
 * The only source of storyteller answers in the film. Off-screen interviewer
 * questions have their own equally explicit route through PromptTrack.
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
        <MediaSequence
          key={segment.id}
          from={fromFrame}
          durationInFrames={durationInFrames}
          name={`speech:${segment.id}`}
        >
          <Audio
            src={resolveSrc(assetPath(props, segment.assetId))}
            trimBefore={msToFrame(segment.sourceInMs, fps)}
            trimAfter={msToFrame(segment.sourceOutMs, fps)}
            // In the Player, wait for the answer rather than play on without
            // it: a pause is noticed less than words out of step with lips.
            pauseWhenBuffering
          />
        </MediaSequence>
      ))}
    </>
  );
};
