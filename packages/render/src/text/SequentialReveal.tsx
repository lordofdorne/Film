import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.js";

/**
 * Title type revealed one word at a time.
 *
 * Deterministic by construction: word k's opacity is a pure function of the
 * current frame, the per-word interval and the fade length. No stagger
 * library, no random jitter, no time source other than the frame.
 */
export const SequentialReveal = ({
  text,
  theme,
  mode,
}: {
  readonly text: string;
  readonly theme: Theme;
  readonly mode: "sequential" | "fade";
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const { revealPerWordMs, revealFadeMs } = theme.title;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: `0 ${Math.round(theme.title.fontSize * 0.28)}px`,
        maxWidth: theme.title.maxWidth,
        fontFamily: theme.fontFamily,
        fontSize: theme.title.fontSize,
        fontWeight: theme.title.fontWeight,
        letterSpacing: theme.title.letterSpacing,
        lineHeight: theme.title.lineHeight,
        color: theme.title.color,
        textAlign: "center",
      }}
    >
      {words.map((word, i) => {
        const startMs = mode === "sequential" ? i * revealPerWordMs : 0;
        const opacity = interpolate(ms, [startMs, startMs + revealFadeMs], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        // A small rise alongside the fade, so the reveal reads as deliberate
        // rather than as a slow render.
        const lift = interpolate(ms, [startMs, startMs + revealFadeMs], [0.18, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <span
            key={`${word}-${String(i)}`}
            style={{
              opacity,
              transform: `translateY(${lift * theme.title.fontSize * 0.2}px)`,
              display: "inline-block",
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
