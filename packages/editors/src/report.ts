import type { EDL } from "@film/edl";

import type { IngestedAnswer } from "./material.js";
import { alignToRuns, timedWordsOf } from "./words.js";

/**
 * What the cut did to each answer, worked out from the cut itself.
 *
 * Shaping is never meant to be a surprise. The person approving the film
 * should be able to see, for every answer that lost words, how much was used
 * and exactly what was left out — before they approve, not after somebody
 * notices a favourite story is missing.
 *
 * Derived rather than stored: the EDL says which stretches of each take play,
 * the answer says which words are where, and the words outside every stretch
 * are what was left out. No second record of the edit exists to disagree
 * with the first, and any editor's cut can be reported the same way.
 */
export type FittedAnswer = {
  readonly questionId: string;
  /** First word to last, as recorded. */
  readonly spokenMs: number;
  /** Speech of this answer that is in the film. */
  readonly usedMs: number;
  readonly totalWords: number;
  readonly keptWords: number;
  /** The passages not in the film, in the order they were said. */
  readonly leftOut: readonly string[];
};

/**
 * Every answer that has words missing from the film. An answer that only
 * lost long pauses is not here: every word of it is still in the film.
 * Answers without word times cannot be reported, and were never shaped.
 */
export const fittedAnswers = (edl: EDL, answers: readonly IngestedAnswer[]): FittedAnswer[] => {
  const fitted: FittedAnswer[] = [];
  for (const answer of answers) {
    const timed = timedWordsOf(answer);
    if (timed === undefined) continue;
    const segments = edl.speechSegments.filter((s) => s.assetId === answer.assetId);
    if (segments.length === 0) continue;

    const words = alignToRuns(timed, answer.runs);
    const kept = words.map((w) => {
      const middle = (w.startMs + w.endMs) / 2;
      return segments.some((s) => middle >= s.sourceInMs && middle <= s.sourceOutMs);
    });
    if (kept.every(Boolean)) continue;

    const leftOut: string[] = [];
    let passage: string[] = [];
    words.forEach((w, i) => {
      if (kept[i] === true) {
        if (passage.length > 0) leftOut.push(passage.join(" "));
        passage = [];
      } else {
        passage.push(w.text);
      }
    });
    if (passage.length > 0) leftOut.push(passage.join(" "));

    const first = words[0];
    const last = words[words.length - 1];
    fitted.push({
      questionId: answer.questionId,
      spokenMs: first === undefined || last === undefined ? 0 : last.endMs - first.startMs,
      usedMs: segments.reduce((total, s) => total + s.durationMs, 0),
      totalWords: words.length,
      keptWords: kept.filter(Boolean).length,
      leftOut,
    });
  }
  return fitted;
};
