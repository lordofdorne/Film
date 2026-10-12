import type { SpeechRun, TimedWord } from "../src/material.js";

/**
 * A long answer the way people actually give one, for tests: sentences with a
 * breath between them, a long thinking pause every third sentence, the odd
 * pause in the middle of a sentence, and a restart full of filler.
 *
 * Words sit inside measured speech already, as `alignToRuns` leaves them.
 */
export type Talk = {
  readonly words: TimedWord[];
  readonly runs: SpeechRun[];
  readonly text: string;
  readonly durationMs: number;
};

const SENTENCES = [
  "We grew up in a small house by the river.",
  "Um, you know, I mean, like, it was.",
  "My mother kept the kettle on all day long for anyone who came.",
  "Nobody ever left that kitchen hungry.",
  "When I was twelve we moved to the city and everything changed.",
  "I missed the river more than I can say.",
  "But the city taught me how to work hard.",
  "Every job I ever had, I gave it everything.",
  "That is the thing I would tell anyone listening.",
  "Give it everything, and be kind while you do.",
];

export const talk = (sentences: number, { startMs = 600 } = {}): Talk => {
  const words: TimedWord[] = [];
  const runs: SpeechRun[] = [];
  let t = startMs;
  for (let s = 0; s < sentences; s++) {
    const sentence = (SENTENCES[s % SENTENCES.length] ?? "").split(" ");
    // A thinking pause in the middle of every fourth sentence.
    const pauseAfter = s % 4 === 3 ? Math.floor(sentence.length / 2) : -1;
    let runStart = t;
    sentence.forEach((text, i) => {
      words.push({ text, startMs: t, endMs: t + 280 });
      t += 300;
      if (i === pauseAfter) {
        runs.push({ startMs: runStart, endMs: t - 20 });
        t += 900;
        runStart = t;
      }
    });
    runs.push({ startMs: runStart, endMs: t - 20 });
    // A breath between sentences; a long think every third.
    t += s % 3 === 2 ? 2_500 : 500;
  }
  return { words, runs, text: words.map((w) => w.text).join(" "), durationMs: t + 1_000 };
};
