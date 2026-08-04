import type { Format } from "@film/formats";
import { safeArea } from "@film/formats";
import type { TemplateStyling } from "@film/templates";

/**
 * Every dimension used by a component is derived here from the active format
 * and the template's styling. No component reads an unscaled constant, so
 * registering a second format changes the numbers everywhere at once.
 */
export type Theme = {
  readonly fontFamily: string;
  readonly safe: { x: number; y: number; width: number; height: number };
  readonly caption: {
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    color: string;
    textShadow: string;
    lineHeight: number;
    maxLines: number;
    bottom: number;
    maxWidth: number;
  };
  readonly question: {
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    color: string;
    textShadow: string;
    lineHeight: number;
    maxWidth: number;
    revealFadeMs: number;
  };
  readonly title: {
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    color: string;
    background: string;
    lineHeight: number;
    maxWidth: number;
    revealPerWordMs: number;
    revealFadeMs: number;
  };
  readonly overlay: {
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    color: string;
    textShadow: string;
    maxWidth: number;
  };
  readonly emphasis: {
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    textShadow: string;
    toneFill: Readonly<Record<"funny" | "meaningful" | "surprising", string>>;
    lineHeight: number;
    maxWidth: number;
    riseMs: number;
    holdScale: number;
  };
};

export const buildTheme = (styling: TemplateStyling, format: Format): Theme => {
  const safe = safeArea(format);
  const scale = format.height * format.captionScale;
  const em = (sizeVh: number): number => Math.round(sizeVh * scale);

  const captionSize = em(styling.caption.sizeVh);
  const questionSize = em(styling.question.sizeVh);
  const titleSize = em(styling.title.sizeVh);
  const overlaySize = em(styling.overlay.sizeVh);
  const emphasisSize = em(styling.emphasis.sizeVh);

  return {
    fontFamily: styling.fontFamily,
    safe,
    caption: {
      fontSize: captionSize,
      fontWeight: styling.caption.weight,
      letterSpacing: styling.caption.tracking * captionSize,
      color: styling.caption.fill,
      textShadow: styling.caption.shadow,
      lineHeight: 1.28,
      maxLines: styling.caption.maxLines,
      bottom: Math.round(styling.caption.bottomInsetVh * format.height),
      maxWidth: safe.width,
    },
    question: {
      fontSize: questionSize,
      fontWeight: styling.question.weight,
      letterSpacing: styling.question.tracking * questionSize,
      color: styling.question.fill,
      textShadow: styling.question.shadow,
      lineHeight: 1.2,
      maxWidth: safe.width,
      revealFadeMs: styling.question.revealFadeMs,
    },
    title: {
      fontSize: titleSize,
      fontWeight: styling.title.weight,
      letterSpacing: styling.title.tracking * titleSize,
      color: styling.title.fill,
      background: styling.title.background,
      lineHeight: 1.18,
      maxWidth: safe.width,
      revealPerWordMs: styling.title.revealPerWordMs,
      revealFadeMs: styling.title.revealFadeMs,
    },
    overlay: {
      fontSize: overlaySize,
      fontWeight: styling.overlay.weight,
      letterSpacing: styling.overlay.tracking * overlaySize,
      color: styling.overlay.fill,
      textShadow: styling.overlay.shadow,
      maxWidth: safe.width,
    },
    emphasis: {
      fontSize: emphasisSize,
      fontWeight: styling.emphasis.weight,
      letterSpacing: styling.emphasis.tracking * emphasisSize,
      textShadow: styling.emphasis.shadow,
      toneFill: styling.emphasis.toneFill,
      lineHeight: 1.22,
      maxWidth: safe.width,
      riseMs: styling.emphasis.riseMs,
      holdScale: styling.emphasis.holdScale,
    },
  };
};
