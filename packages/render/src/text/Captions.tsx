import type { SpeechSegment } from "@film/edl";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.js";
import { buildCaptionCards, cardAt, charsPerLine } from "./lines.js";

/**
 * Standard and emphasis captions for one speech segment.
 *
 * captionPolicy is "all-speech": every word is captioned regardless of what
 * the picture is doing. This layer therefore reads only the speech track and
 * never inspects the visual timeline — which is also what keeps it independent
 * of whether a photo, b-roll or the subject happens to be on screen.
 *
 * Because captions sit over photographs for roughly a third of the film,
 * legibility against a bright image is a correctness property rather than a
 * matter of taste; the shadow in the template's caption style is load-bearing.
 */
export const Captions = ({
  segment,
  theme,
}: {
  readonly segment: SpeechSegment;
  readonly theme: Theme;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const cards = buildCaptionCards(segment.captions, {
    maxCharsPerLine: charsPerLine(theme.caption.maxWidth, theme.caption.fontSize),
    maxLinesPerCard: theme.caption.maxLines,
    emphasis: segment.emphasis,
  });

  const card = cardAt(cards, ms);
  if (card === undefined) return null;

  const isEmphasis = card.emphasis !== null;
  const style = isEmphasis ? theme.emphasis : theme.caption;

  // A short rise on entry. Emphasis rises further and holds slightly larger.
  const age = ms - card.startMs;
  const riseMs = isEmphasis ? theme.emphasis.riseMs : 160;
  const opacity = interpolate(age, [0, riseMs], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = isEmphasis
    ? interpolate(age, [0, riseMs], [0.965, theme.emphasis.holdScale], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const lift = interpolate(age, [0, riseMs], [isEmphasis ? 0.5 : 0.25, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const color = isEmphasis && card.emphasis !== null
    ? theme.emphasis.toneFill[card.emphasis]
    : theme.caption.color;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: theme.caption.bottom,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: style.maxWidth,
          textAlign: "center",
          fontFamily: theme.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          lineHeight: style.lineHeight,
          textShadow: style.textShadow,
          textWrap: "balance",
          color,
          opacity,
          transform: `translateY(${lift * style.fontSize * 0.3}px) scale(${scale})`,
        }}
      >
        {card.text}
      </div>
    </AbsoluteFill>
  );
};
