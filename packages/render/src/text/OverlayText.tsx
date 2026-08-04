import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.js";

/**
 * A template text key rendered over picture, in the reduced overlay
 * treatment. This is how the opening line sits over a candid moving image
 * rather than on a black card.
 *
 * The caller passes already-resolved text; a segment carries a text KEY, never
 * a literal, and resolution fails before render rather than during it.
 */
export const OverlayText = ({
  text,
  theme,
}: {
  readonly text: string;
  readonly theme: Theme;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const opacity = interpolate(ms, [120, 640], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lift = interpolate(ms, [120, 640], [0.4, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "flex-start",
        padding: `${theme.safe.y}px ${theme.safe.x}px`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: theme.overlay.maxWidth,
          fontFamily: theme.fontFamily,
          fontSize: theme.overlay.fontSize,
          fontWeight: theme.overlay.fontWeight,
          letterSpacing: theme.overlay.letterSpacing,
          color: theme.overlay.color,
          textShadow: theme.overlay.textShadow,
          lineHeight: 1.3,
          textWrap: "balance",
          opacity,
          transform: `translateY(${lift * theme.overlay.fontSize * 0.5}px)`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
