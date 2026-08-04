import { AbsoluteFill, Sequence } from "remotion";
import { MusicBed } from "./audio/MusicBed.js";
import { PromptTrack } from "./audio/PromptTrack.js";
import { SpeechTrack } from "./audio/SpeechTrack.js";
import { assertFontReady, registerFont } from "./fonts.js";
import type { FilmProps } from "./props.js";
import { VisualSegmentView } from "./segments/VisualSegmentView.js";
import { Captions } from "./text/Captions.js";
import { QuestionPrompt } from "./text/QuestionPrompt.js";
import { buildTheme } from "./theme.js";
import { promptWindows, speechWindows, visualWindows } from "./timing/windows.js";

// Register the face during module evaluation, before React mounts.
registerFont();

/**
 * The whole film: a pure function of (EDL, format, frame).
 *
 * No Math.random, no Date.now, no reads of anything outside props. Every
 * choice that could have varied was resolved upstream and stored in the EDL,
 * which is what makes two renders of the same document comparable frame by
 * frame.
 *
 * Layer order, bottom to top:
 *   black backdrop   — what a `fade` transition reveals
 *   visual segments  — in array order, so an incoming segment paints over its
 *                      predecessor and its opacity ramp IS the crossfade
 *   answer captions  — above all picture, driven only by the speech track
 *   question prompts — timed question text, optionally paired with audio
 *   audio            — answers, interviewer prompts, then ducked music
 */
export const FilmComposition = (props: FilmProps) => {
  const { edl, format, styling } = props;
  assertFontReady();
  const theme = buildTheme(styling, format);
  const showCaptions = styling.captionPolicy !== "emphasis-only";

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {visualWindows(edl).map((window) => (
        <Sequence
          key={window.segment.id}
          from={window.fromFrame}
          durationInFrames={window.durationInFrames}
          layout="none"
          name={`${window.segment.kind}:${window.segment.id}`}
        >
          <VisualSegmentView window={window} props={props} theme={theme} />
        </Sequence>
      ))}

      {showCaptions &&
        speechWindows(edl).map(({ segment, fromFrame, durationInFrames }) => (
          <Sequence
            key={`caption-${segment.id}`}
            from={fromFrame}
            durationInFrames={durationInFrames}
            layout="none"
            name={`captions:${segment.id}`}
          >
            <Captions segment={segment} theme={theme} />
          </Sequence>
        ))}

      {promptWindows(edl).map(({ segment, fromFrame, durationInFrames }) => (
        <Sequence
          key={`question-${segment.id}`}
          from={fromFrame}
          durationInFrames={durationInFrames}
          layout="none"
          name={`question:${segment.id}`}
        >
          <QuestionPrompt segment={segment} theme={theme} />
        </Sequence>
      ))}

      <SpeechTrack props={props} />
      <PromptTrack props={props} />
      <MusicBed props={props} />
    </AbsoluteFill>
  );
};
