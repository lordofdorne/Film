import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { IngestedAnswer, SpeechRun, TimedWord } from "../src/material.js";
import { alignToRuns, captionsWithin, phrasesOf, timedWordsOf } from "../src/words.js";

/**
 * Two real takes, as transcription and ingest saw them on 2026-10-12: the
 * words with whisper's times (two passes, matched), and the speech ingest
 * measured from the waveform.
 *
 * `take-recorded` is a person recorded in a browser — 20 s, 7 stretches of
 * speech. `take-synthetic` is the synthetic voice the test film was made
 * with — 30 s, 15 stretches, more pauses than sentences. Whisper alone put 10
 * of the first's 40 words and 35 of the second's 77 in silence.
 *
 * The WORDS are not what was said. This repository is public and these are
 * recordings of a person, so every word was swapped for a neutral one with
 * its capital letter and punctuation kept; every time, every stretch of
 * speech, and so every phrase boundary, is the take's own. The phrases below
 * fall exactly where the real ones did.
 */
type Take = { readonly text: string; readonly words: TimedWord[]; readonly runs: SpeechRun[] };
const take = (name: string): Take =>
  JSON.parse(readFileSync(new URL(`./takes/${name}.json`, import.meta.url), "utf8")) as Take;

const RECORDED = take("take-recorded");
const SYNTHETIC = take("take-synthetic");

const insideARun = (w: TimedWord, runs: readonly SpeechRun[]): boolean =>
  runs.some((r) => w.startMs >= r.startMs && w.endMs <= r.endMs);

describe("alignToRuns", () => {
  it.each([
    ["recorded", RECORDED],
    ["synthetic", SYNTHETIC],
  ] as const)("puts every word of the %s take inside measured speech, in order", (_n, t) => {
    const aligned = alignToRuns(t.words, t.runs);
    expect(aligned.map((w) => w.text)).toEqual(t.words.map((w) => w.text));
    for (const w of aligned) expect(insideARun(w, t.runs), `${w.text}@${String(w.startMs)}`).toBe(true);
    for (let i = 1; i < aligned.length; i++) {
      expect(aligned[i]?.startMs ?? 0).toBeGreaterThanOrEqual(aligned[i - 1]?.endMs ?? 0);
    }
  });

  it("leaves words alone when nothing was measured", () => {
    expect(alignToRuns(RECORDED.words, [])).toEqual(RECORDED.words);
  });
});

describe("phrasesOf", () => {
  it("finds every sentence of the recorded take, whole", () => {
    const phrases = phrasesOf(alignToRuns(RECORDED.words, RECORDED.runs));
    expect(phrases.map((p) => p.text)).toEqual([
      "The kettle was always on and we would sit by the window.",
      "Talking about nothing in particular while the rain.",
      "Came down over the garden and the.",
      "Dog slept.",
      "By the door.",
      "Every morning she.",
      "Made toast for.",
      "Everyone even.",
    ]);
    expect(phrases.every((p) => p.endsSentence)).toBe(true);
  });

  it("splits at long pauses too, and says which splits end a sentence", () => {
    const phrases = phrasesOf(alignToRuns(SYNTHETIC.words, SYNTHETIC.runs));
    // A pause mid-sentence is a place a cut can go, but not a sentence end.
    const thinking = phrases.find((p) => p.text === "And somehow it was,");
    expect(thinking?.endsSentence).toBe(false);
    // Words placed in the gaps are joined to the sentence they belong to.
    // (In the real take: "And the years went away." and "the certainty never came.")
    expect(phrases.map((p) => p.text)).toContain("Came down over the garden.");
    expect(phrases.map((p) => p.text)).toContain("particular while the rain.");
    // Every word is in exactly one phrase.
    expect(phrases.map((p) => p.text).join(" ")).toBe(SYNTHETIC.text);
  });

  it("indexes its words back into the answer", () => {
    const aligned = alignToRuns(RECORDED.words, RECORDED.runs);
    for (const p of phrasesOf(aligned)) {
      expect(aligned.slice(p.firstWord, p.lastWord + 1).map((w) => w.text).join(" ")).toBe(p.text);
    }
  });
});

describe("captionsWithin", () => {
  const aligned = alignToRuns(RECORDED.words, RECORDED.runs);

  it("shows only the words spoken inside the piece, timed from its start", () => {
    const run = RECORDED.runs[3]; // the second sentence's stretch
    if (run === undefined) throw new Error("fixture");
    const captions = captionsWithin(aligned, run.startMs, run.endMs, run.startMs, run.endMs - run.startMs);
    expect(captions.map((c) => c.text).join(" ")).toBe("Talking about nothing in particular while the rain.");
    expect(captions[0]?.startMs).toBe(0);
    for (const c of captions) {
      expect(c.startMs).toBeLessThan(c.endMs);
      expect(c.endMs).toBeLessThanOrEqual(run.endMs - run.startMs);
    }
  });
});

describe("timedWordsOf", () => {
  const answer: IngestedAnswer = {
    questionId: "q",
    assetId: "a",
    durationMs: 20_000,
    runs: RECORDED.runs,
    spoken: RECORDED.text,
    words: RECORDED.words,
  };

  it("uses the words while they still match what was said", () => {
    expect(timedWordsOf(answer)).toBe(RECORDED.words);
  });

  it("drops them once the text was corrected, rather than misplace a word", () => {
    expect(timedWordsOf({ ...answer, spoken: RECORDED.text.replace("garden", "orchard") })).toBeUndefined();
    expect(timedWordsOf({ ...answer, spoken: `${RECORDED.text} Really.` })).toBeUndefined();
  });

  it("has none to give for typed words", () => {
    const { words: _none, ...typed } = answer;
    expect(timedWordsOf(typed)).toBeUndefined();
  });
});
