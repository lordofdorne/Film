import { isRecordedPrompt } from "@film/edl";
import { Audio, Sequence } from "remotion";
import { resolveSrc } from "../assets/resolveSrc.js";
import { assetPath, type FilmProps } from "../props.js";
import { msToFrame, promptWindows } from "../timing/windows.js";

/** The only audio path for off-screen interviewer questions. */
export const PromptTrack = ({ props }: { readonly props: FilmProps }) => {
  const { fps } = props.format;

  return (
    <>
      {promptWindows(props.edl).map(({ segment, fromFrame, durationInFrames }) => {
        if (!isRecordedPrompt(segment)) return null;
        return (
          <Sequence
            key={segment.id}
            from={fromFrame}
            durationInFrames={durationInFrames}
            layout="none"
            name={`question-audio:${segment.id}`}
          >
            <Audio
              src={resolveSrc(assetPath(props, segment.assetId))}
              trimBefore={msToFrame(segment.sourceInMs, fps)}
              trimAfter={msToFrame(segment.sourceOutMs, fps)}
            />
          </Sequence>
        );
      })}
    </>
  );
};
