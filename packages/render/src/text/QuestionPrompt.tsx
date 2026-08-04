import type { QuestionPromptSegment } from "@film/edl";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.js";

/** A question revealed word by word over the storyteller's picture. */
export const QuestionPrompt = ({
  segment,
  theme,
}: {
  readonly segment: QuestionPromptSegment;
  readonly theme: Theme;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: `${theme.safe.y}px ${theme.safe.x}px`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: theme.question.maxWidth,
          textAlign: "center",
          textWrap: "balance",
          fontFamily: theme.fontFamily,
          fontSize: theme.question.fontSize,
          fontWeight: theme.question.fontWeight,
          letterSpacing: theme.question.letterSpacing,
          lineHeight: theme.question.lineHeight,
          color: theme.question.color,
          textShadow: theme.question.textShadow,
        }}
      >
        {segment.captions.map((word, index) => {
          const opacity = interpolate(
            ms,
            [word.startMs, word.startMs + theme.question.revealFadeMs],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          return (
            <span key={`${String(index)}-${word.text}`} style={{ opacity }}>
              {index === 0 ? "" : " "}
              {word.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
