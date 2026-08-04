import type { EmphasisSelection, WordCaption } from "@film/edl";

export type CaptionCard = {
  readonly words: readonly WordCaption[];
  readonly text: string;
  /** Relative to the speech segment, like the words themselves. */
  readonly startMs: number;
  readonly endMs: number;
  readonly emphasis: EmphasisSelection["tone"] | null;
};

/**
 * Greedy line breaking. Deterministic and pure — the same words always break
 * the same way, which is what lets a golden frame test caption wrapping.
 */
const breakIntoLines = (
  words: readonly WordCaption[],
  maxCharsPerLine: number,
): WordCaption[][] => {
  const lines: WordCaption[][] = [];
  let current: WordCaption[] = [];
  let length = 0;

  for (const word of words) {
    const added = current.length === 0 ? word.text.length : length + 1 + word.text.length;
    if (current.length > 0 && added > maxCharsPerLine) {
      lines.push(current);
      current = [word];
      length = word.text.length;
    } else {
      current.push(word);
      length = added;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
};

const toCard = (
  words: readonly WordCaption[],
  emphasis: EmphasisSelection["tone"] | null,
): CaptionCard => {
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("cannot build a caption card from zero words");
  }
  return {
    words,
    text: words.map((w) => w.text).join(" "),
    startMs: first.startMs,
    endMs: last.endMs,
    emphasis,
  };
};

/**
 * Group a segment's words into the cards that appear on screen.
 *
 * An emphasis range is split out into its own cards rather than being
 * highlighted inside an ordinary one. That is the whole point of the
 * treatment: the line stands alone, at most twice per film.
 *
 * Card end times are stretched to meet the next card's start, so the 60ms
 * gaps between words do not flicker the caption off and back on.
 */
export const buildCaptionCards = (
  captions: readonly WordCaption[],
  options: {
    readonly maxCharsPerLine: number;
    readonly maxLinesPerCard: number;
    readonly emphasis?: EmphasisSelection | undefined;
  },
): CaptionCard[] => {
  const { maxCharsPerLine, maxLinesPerCard, emphasis } = options;
  if (captions.length === 0) return [];

  // Runs of words that must not share a card with their neighbours.
  type Run = { words: readonly WordCaption[]; tone: EmphasisSelection["tone"] | null };
  const runs: Run[] = [];

  if (emphasis === undefined) {
    runs.push({ words: captions, tone: null });
  } else {
    const before = captions.slice(0, emphasis.startWord);
    const inside = captions.slice(emphasis.startWord, emphasis.endWord + 1);
    const after = captions.slice(emphasis.endWord + 1);
    if (before.length > 0) runs.push({ words: before, tone: null });
    if (inside.length > 0) runs.push({ words: inside, tone: emphasis.tone });
    if (after.length > 0) runs.push({ words: after, tone: null });
  }

  const cards: CaptionCard[] = [];
  for (const run of runs) {
    const lines = breakIntoLines(run.words, maxCharsPerLine);
    for (let i = 0; i < lines.length; i += maxLinesPerCard) {
      const chunk = lines.slice(i, i + maxLinesPerCard).flat();
      if (chunk.length > 0) cards.push(toCard(chunk, run.tone));
    }
  }

  // Close the gaps so captions do not blink between cards.
  return cards.map((card, i) => {
    const next = cards[i + 1];
    return next === undefined ? card : { ...card, endMs: next.startMs };
  });
};

/** The card visible at `ms` (relative to the speech segment), if any. */
export const cardAt = (cards: readonly CaptionCard[], ms: number): CaptionCard | undefined =>
  cards.find((c) => ms >= c.startMs && ms < c.endMs);

/**
 * Rough characters-per-line for a font size, used to pick line breaks.
 * 0.52em average advance is a good approximation for a humanist sans at
 * sentence case; being slightly conservative is preferable to overflowing.
 */
export const charsPerLine = (availableWidthPx: number, fontSizePx: number): number =>
  Math.max(8, Math.floor(availableWidthPx / (fontSizePx * 0.52)));
