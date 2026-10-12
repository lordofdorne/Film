import { describe, expect, it } from "vitest";

import { attachTimings, parseTimedWords } from "../src/media/whisper.js";

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });

describe("attachTimings", () => {
  it("gives every word of the text pass the time of its partner in the timed pass", () => {
    const words = attachTimings(["Sit", "down.", "Pour", "the", "tea."], [
      // The kinds of difference the timed pass made on a real take on
      // 2026-10-12: a comma for a full stop, an extra "like", a lower case.
      w("Sit", 11_500, 11_890),
      w("down,", 11_890, 13_040),
      w("like", 13_040, 13_500),
      w("pour", 13_500, 14_000),
      w("the", 14_000, 14_630),
      w("tea,", 14_630, 15_170),
    ]);
    // The words are the text pass's, punctuation and all; only times move.
    expect(words).toEqual([
      w("Sit", 11_500, 11_890),
      w("down.", 11_890, 13_040),
      w("Pour", 13_500, 14_000),
      w("the", 14_000, 14_630),
      w("tea.", 14_630, 15_170),
    ]);
  });

  it("times a word the timed pass missed from between its neighbours", () => {
    const words = attachTimings(["one", "two", "three"], [w("one", 0, 1_000), w("three", 3_000, 4_000)]);
    expect(words.map((x) => x.text)).toEqual(["one", "two", "three"]);
    const two = words[1];
    expect(two?.startMs).toBe(1_000);
    expect(two?.endMs).toBe(3_000);
  });

  it("returns no times rather than invented ones when the timed pass heard nothing", () => {
    expect(attachTimings(["anything"], [])).toEqual([]);
  });
});

describe("parseTimedWords", () => {
  it("reads one word per segment and skips the rest", () => {
    const raw = JSON.stringify({
      transcription: [
        { text: "", offsets: { from: 0, to: 30 } },
        { text: " [MUSIC PLAYING]", offsets: { from: 30, to: 900 } },
        { text: " don't", offsets: { from: 900, to: 1_200 } },
        { text: " wait", offsets: { from: 1_200, to: 1_500 } },
      ],
    });
    expect(parseTimedWords(raw)).toEqual([w("don't", 900, 1_200), w("wait", 1_200, 1_500)]);
  });

  it("survives a file whisper did not finish", () => {
    expect(parseTimedWords("")).toEqual([]);
    expect(parseTimedWords("{}")).toEqual([]);
  });
});
