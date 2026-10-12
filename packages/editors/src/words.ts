import type { WordCaption } from "@film/edl";

import type { IngestedAnswer, SpeechRun, TimedWord } from "./material.js";

/**
 * Words with times on them, and what an editor can do with that.
 *
 * Two measurements of the same answer disagree in a useful way. Whisper knows
 * WHICH word was said and roughly when, but its times run early and stretch
 * across silences — up to 600 ms on the takes this was built against. Ingest
 * knows exactly WHEN somebody was speaking, from the waveform, and nothing
 * about which words. So: whisper decides which stretch of speech each word
 * belongs to, and ingest's stretches decide the times.
 *
 * Before this, captions were laid out by `distributeWords`, which had to guess
 * the first half too — it gave each stretch a share of the words in
 * proportion to its length. That guess is what this replaces wherever there
 * are timed words, and `distributeWords` stays for answers that have none
 * (typed in at intake, or transcribed before timings were kept).
 */

/** Shorter than this, a whisper word is a blip; it still gets some share. */
const MIN_WORD_WEIGHT_MS = 80;
/** A breath between words, so consecutive captions do not touch. */
const WORD_GAP_MS = 20;

/**
 * The answer's timed words, if they still describe its text.
 *
 * Words are kept only while they match `spoken` word for word. If somebody
 * corrects the text by hand the old timings no longer fit it, and laying the
 * new words on the old times would put the wrong word on screen — so then
 * there are none, and the editor falls back to spreading the words evenly.
 */
export const timedWordsOf = (answer: IngestedAnswer): readonly TimedWord[] | undefined => {
  const words = answer.words;
  if (words === undefined || words.length === 0) return undefined;
  const spoken = answer.spoken.split(/\s+/).filter((w) => w.length > 0);
  if (spoken.length !== words.length) return undefined;
  return spoken.every((w, i) => words[i]?.text === w) ? words : undefined;
};

/**
 * Which stretch of speech a word belongs to, never earlier than `floor`.
 *
 * Inside a stretch: that one. In the gap between two, timing alone cannot
 * say — whisper is early on some words and late on others — but punctuation
 * can. A word that ends a sentence finishes the stretch before it ("Take that
 * trip."); a word that starts one opens the stretch after ("Switch that
 * major. Try that business."). Anything else goes to the nearer. Each of the
 * three alone misplaced words on the two takes this was built against; all
 * three together placed every one.
 */
const runFor = (
  word: TimedWord,
  runs: readonly SpeechRun[],
  floor: number,
  startsSentence: boolean,
): number => {
  const middle = (word.startMs + word.endMs) / 2;
  let previous = -1;
  for (let r = floor; r < runs.length; r++) {
    const run = runs[r];
    if (run === undefined) continue;
    if (middle >= run.startMs && middle <= run.endMs) return r;
    if (run.startMs > middle) {
      const before = previous === -1 ? undefined : runs[previous];
      if (before === undefined) return r;
      if (ENDS_SENTENCE.test(word.text)) return previous;
      if (startsSentence) return r;
      return middle - before.endMs <= run.startMs - middle ? previous : r;
    }
    previous = r;
  }
  return previous === -1 ? floor : previous;
};

/**
 * Whisper's words, moved onto the speech ingest measured.
 *
 * Each word goes to the stretch of speech it was said in (`runFor`) — never
 * to an earlier stretch than the word before it, because words are said in
 * order. Within a stretch the words share its time in proportion
 * to how long whisper heard each one: a long word stays long, a blip stays
 * short, and nothing lands in a silence.
 *
 * A stretch whisper put no words in is left empty. That is usually a breath,
 * a laugh or a chair, and a caption is the wrong thing to put on it.
 */
export const alignToRuns = (
  words: readonly TimedWord[],
  runs: readonly SpeechRun[],
): TimedWord[] => {
  if (runs.length === 0 || words.length === 0) return [...words];

  const runOf: number[] = [];
  let floor = 0;
  words.forEach((word, i) => {
    const before = words[i - 1];
    floor = runFor(word, runs, floor, before === undefined || ENDS_SENTENCE.test(before.text));
    runOf.push(floor);
  });

  const aligned: TimedWord[] = [];
  let i = 0;
  while (i < words.length) {
    const r = runOf[i] ?? 0;
    let j = i;
    while (j < words.length && runOf[j] === r) j++;
    const run = runs[r];
    const group = words.slice(i, j);
    if (run === undefined) {
      aligned.push(...group);
    } else {
      const weights = group.map((w) => Math.max(w.endMs - w.startMs, MIN_WORD_WEIGHT_MS));
      const total = weights.reduce((a, b) => a + b, 0);
      const length = run.endMs - run.startMs;
      let cursor = run.startMs;
      group.forEach((word, k) => {
        const share = ((weights[k] ?? 0) / total) * length;
        const startMs = Math.round(cursor);
        const endMs = Math.max(startMs + 1, Math.round(cursor + share) - WORD_GAP_MS);
        aligned.push({ text: word.text, startMs, endMs });
        cursor += share;
      });
    }
    i = j;
  }
  return aligned;
};

/**
 * Captions for one piece of an answer: the words spoken inside it, timed
 * relative to where that piece starts.
 *
 * Only the words whose middle falls between `fromMs` and `toMs` — so a piece
 * that plays the second half of an answer shows the second half's words, not
 * the whole answer squeezed into it.
 */
export const captionsWithin = (
  aligned: readonly TimedWord[],
  fromMs: number,
  toMs: number,
  spanStartMs: number,
  spanDurationMs: number,
): WordCaption[] => {
  const inside = aligned.filter((w) => {
    const middle = (w.startMs + w.endMs) / 2;
    return middle >= fromMs && middle <= toMs;
  });
  let previousEnd = -1;
  return inside.map((w) => {
    const rawStart = Math.min(Math.max(w.startMs - spanStartMs, 0), spanDurationMs - 2);
    const startMs = Math.max(rawStart, previousEnd);
    const endMs = Math.max(startMs + 1, Math.min(w.endMs - spanStartMs, spanDurationMs));
    previousEnd = endMs;
    return { text: w.text, startMs, endMs };
  });
};

/**
 * A run of words that can be kept or left out as one piece.
 *
 * The unit Block 3 will choose from when an answer is longer than its share
 * of the film: cutting between phrases never cuts a word, and cutting at the
 * end of a sentence never leaves a thought hanging.
 */
export type Phrase = {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  /** Index of the first and last word in the answer. */
  readonly firstWord: number;
  readonly lastWord: number;
  /** Ends on . ? or ! — a whole thought, not just a breath. */
  readonly endsSentence: boolean;
};

/** A pause this long between two words is a place a cut can go. */
export const PHRASE_PAUSE_MS = 700;

const ENDS_SENTENCE = /[.?!]["'”’)]*$/;

/**
 * An answer's phrases: split after a full stop, a question mark or an
 * exclamation, and wherever the speaker paused for `PHRASE_PAUSE_MS`.
 *
 * Both, because neither is enough alone. Whisper leaves punctuation out of
 * some takes altogether (it did on every take of the synthetic test film), and
 * people pause mid-sentence to think. A sentence end is a better place to cut
 * than a pause, which is what `endsSentence` is for.
 */
export const phrasesOf = (aligned: readonly TimedWord[]): Phrase[] => {
  const phrases: Phrase[] = [];
  let first = 0;
  aligned.forEach((word, i) => {
    const next = aligned[i + 1];
    const sentence = ENDS_SENTENCE.test(word.text);
    const pause = next !== undefined && next.startMs - word.endMs >= PHRASE_PAUSE_MS;
    if (next !== undefined && !sentence && !pause) return;
    const words = aligned.slice(first, i + 1);
    phrases.push({
      startMs: words[0]?.startMs ?? word.startMs,
      endMs: word.endMs,
      text: words.map((w) => w.text).join(" "),
      firstWord: first,
      lastWord: i,
      endsSentence: sentence,
    });
    first = i + 1;
  });
  return phrases;
};
