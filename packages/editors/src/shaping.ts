import type { SpeechRun, TimedWord } from "./material.js";
import { phrasesOf } from "./words.js";

/**
 * Fitting one answer into its share of the film, without cutting a word or a
 * thought.
 *
 * Owner's rule, 2026-10-12: a long recording is shaped to the template's
 * length; a short one is left alone and stays a good short film. So nothing
 * here runs unless an answer is longer than its share, and then in two steps:
 *
 *   1. Tighten. Pauses longer than `LONG_PAUSE_MS` are taken out — the
 *      thinking before a sentence, not the breath inside one. Often that is
 *      enough and every word stays.
 *   2. Choose. If it is still too long, keep the strongest whole sentences in
 *      the order they were said, and leave the rest out.
 *
 * Two rules make every cut safe, and they are the reason this is built on
 * measured silence rather than on word times:
 *
 *   - Never mid-word. A cut only ever falls in a silence ingest measured from
 *     the waveform — a gap between two stretches of speech. Inside a stretch,
 *     word boundaries are estimates, and an estimate is not good enough to cut
 *     on.
 *   - Never mid-thought. What can be kept or left out is a UNIT: one or more
 *     whole sentences, starting and ending in measured silence.
 */

/** A pause this long is thinking, not breathing, and can be taken out. */
export const LONG_PAUSE_MS = 1_200;
/** A gap this long between two words is measured silence: a cut can go there. */
const CUT_GAP_MS = 200;
/** A piece shorter than this is a flinch; a pause around it stays rather than leave one. */
const MIN_PIECE_MS = 1_500;
/** Each separate piece costs its handles either side; counted against the share. */
const PIECE_HANDLES_MS = 400;

const FILLERS = new Set(["um", "uh", "erm", "er", "hmm", "like", "basically", "literally"]);
const FILLER_PAIRS = new Set(["you know", "i mean", "sort of", "kind of"]);

/** One or more whole sentences, starting and ending in measured silence. */
export type Unit = {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly firstWord: number;
  readonly lastWord: number;
};

export type Shaped = {
  /** The stretches of the take to play, in order. Source time. */
  readonly spans: readonly SpeechRun[];
  /** Nothing was over: play the answer as it was recorded. */
  readonly untouched: boolean;
  /** How long it was, and how long it is now, first word to last. */
  readonly spokenMs: number;
  readonly keptMs: number;
  readonly units: number;
  readonly keptUnits: number;
};

const ENDS_SENTENCE = /[.?!]["'”’)]*$/;

/**
 * The answer, cut into units.
 *
 * A unit closes at a sentence end that is also measured silence. A speaker who
 * runs sentences together without pausing makes bigger units — those
 * sentences can only be kept or dropped together, because there is nowhere
 * safe to cut between them. If the transcript has no punctuation at all
 * (whisper leaves it out of some takes), pauses stand in for sentence ends.
 */
export const unitsOf = (words: readonly TimedWord[]): Unit[] => {
  if (words.length === 0) return [];
  const punctuated = words.some((w) => ENDS_SENTENCE.test(w.text));
  const sentenceEnds = new Set(
    punctuated
      ? words.flatMap((w, i) => (ENDS_SENTENCE.test(w.text) ? [i] : []))
      : phrasesOf(words).map((p) => p.lastWord),
  );

  const units: Unit[] = [];
  let first = 0;
  words.forEach((word, i) => {
    const next = words[i + 1];
    const silenceAfter = next === undefined || next.startMs - word.endMs >= CUT_GAP_MS;
    if (next !== undefined && !(sentenceEnds.has(i) && silenceAfter)) return;
    const own = words.slice(first, i + 1);
    units.push({
      startMs: own[0]?.startMs ?? word.startMs,
      endMs: word.endMs,
      text: own.map((w) => w.text).join(" "),
      firstWord: first,
      lastWord: i,
    });
    first = i + 1;
  });
  return units;
};

const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9' ]/g, "");

/**
 * How much a unit is worth keeping, when not all of them can be.
 *
 * Deliberately simple and explainable, because somebody will ask why a
 * sentence went: the opening sets up the answer, the phrase somebody marked
 * as the point of it is the point of it, the last sentence is usually the
 * conclusion, and a sentence full of "um" and "you know" is usually a
 * restart. Ties go to whatever was said first.
 */
const scoreOf = (unit: Unit, index: number, count: number, emphasis: string | undefined): number => {
  const words = normalise(unit.text).split(/\s+/).filter((w) => w.length > 0);
  let fillers = words.filter((w) => FILLERS.has(w)).length;
  for (let i = 0; i + 1 < words.length; i++) {
    if (FILLER_PAIRS.has(`${words[i] ?? ""} ${words[i + 1] ?? ""}`)) fillers += 1;
  }
  let score = 1;
  if (index === 0) score += 3;
  if (index === count - 1 && count > 1) score += 1;
  if (emphasis !== undefined && normalise(unit.text).includes(normalise(emphasis))) score += 5;
  if (words.length < 4) score -= 0.5;
  score -= words.length === 0 ? 0 : (fillers / words.length) * 4;
  return score;
};

/**
 * The kept units as stretches of the take, with long pauses taken out — but
 * never leaving a piece too short to be a shot.
 */
const spansOf = (kept: readonly Unit[], words: readonly TimedWord[]): SpeechRun[] => {
  const spans: { startMs: number; endMs: number; lastWord: number }[] = [];
  for (const unit of kept) {
    const previous = spans[spans.length - 1];
    const adjacent = previous !== undefined && previous.lastWord + 1 === unit.firstWord;
    const pause = previous === undefined ? 0 : unit.startMs - previous.endMs;
    if (previous !== undefined && adjacent && pause <= LONG_PAUSE_MS) {
      previous.endMs = unit.endMs;
      previous.lastWord = unit.lastWord;
    } else {
      spans.push({ startMs: unit.startMs, endMs: unit.endMs, lastWord: unit.lastWord });
    }
  }

  // Long pauses inside a kept stretch, in measured silence, come out too —
  // where both sides are long enough to stand as a shot.
  const tightened: SpeechRun[] = [];
  for (const span of spans) {
    let start = span.startMs;
    const inside = words.filter((w) => w.startMs >= span.startMs && w.endMs <= span.endMs);
    inside.forEach((word, i) => {
      const next = inside[i + 1];
      if (next === undefined) return;
      const gap = next.startMs - word.endMs;
      if (gap > LONG_PAUSE_MS && word.endMs - start >= MIN_PIECE_MS && span.endMs - next.startMs >= MIN_PIECE_MS) {
        tightened.push({ startMs: start, endMs: word.endMs });
        start = next.startMs;
      }
    });
    tightened.push({ startMs: start, endMs: span.endMs });
  }
  return tightened;
};

const lengthOf = (spans: readonly SpeechRun[]): number =>
  spans.reduce((total, s) => total + (s.endMs - s.startMs), 0) +
  Math.max(0, spans.length - 1) * PIECE_HANDLES_MS;

/**
 * Shape one answer to `budgetMs`.
 *
 * `words` are the answer's words already on measured speech (`alignToRuns`),
 * limited to the part being placed. An answer within its share is returned
 * untouched, which is every answer of every film made before word times
 * existed — they have no words to shape by.
 *
 * Over budget even with one unit (somebody said one long sentence with no
 * pause in it): the first unit is kept whole anyway. A film slightly long is
 * better than a thought cut in half.
 */
export const shapeAnswer = (
  words: readonly TimedWord[],
  budgetMs: number,
  emphasis?: string,
): Shaped => {
  const first = words[0];
  const last = words[words.length - 1];
  const spokenMs = first === undefined || last === undefined ? 0 : last.endMs - first.startMs;
  const units = unitsOf(words);
  const whole: Shaped = {
    spans: first === undefined || last === undefined ? [] : [{ startMs: first.startMs, endMs: last.endMs }],
    untouched: true,
    spokenMs,
    keptMs: spokenMs,
    units: units.length,
    keptUnits: units.length,
  };
  if (spokenMs <= budgetMs || units.length === 0) return whole;

  // 1. Tighten: every unit, long pauses out.
  const all = spansOf(units, words);
  if (lengthOf(all) <= budgetMs) {
    return { ...whole, spans: all, untouched: false, keptMs: lengthOf(all) };
  }

  // 2. Choose: strongest first, until the share is full; then back in order.
  const ranked = units
    .map((unit, index) => ({ unit, index, score: scoreOf(unit, index, units.length, emphasis) }))
    .sort((x, y) => y.score - x.score || x.index - y.index);
  const chosen = new Set<number>();
  for (const { index } of ranked) {
    const trial = units.filter((_, i) => chosen.has(i) || i === index);
    if (chosen.size === 0 || lengthOf(spansOf(trial, words)) <= budgetMs) chosen.add(index);
  }
  const kept = units.filter((_, i) => chosen.has(i));
  const spans = spansOf(kept, words);
  return { ...whole, spans, untouched: false, keptMs: lengthOf(spans), keptUnits: kept.length };
};
