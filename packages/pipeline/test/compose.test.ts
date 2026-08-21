import { describe, expect, it } from "vitest";

import { openingWords } from "../src/compose/plan.js";

/**
 * The cold open's words when nobody chose any.
 *
 * `coldOpen` is optional and always had been, but every film that ever reached
 * compose came from intake, where a human types it in. The first film made in
 * a browser had none — transcription produces what was said, not which part of
 * it is the hook — and compose failed permanently with
 * `SCHEMA_INVALID at speechSegments.0.captions`, which names the array and not
 * the missing field that emptied it.
 */
describe("openingWords", () => {
  const runs = [
    { startMs: 0, endMs: 2000 },
    { startMs: 3000, endMs: 9000 },
  ];

  it("takes the first run's share of the words, from the front", () => {
    // 8000ms of speech, the first run is a quarter of it, so 2 of 8 words.
    const words = openingWords("one two three four five six seven eight", runs);
    expect(words).toEqual(["one", "two"]);
  });

  it("never returns nothing when there is something to say", () => {
    // A very short opening run against a long answer still rounds to zero
    // words — and zero captions is the failure this exists to prevent.
    const words = openingWords("a b c d e f g h i j k l m n o p q r s t", [
      { startMs: 0, endMs: 10 },
      { startMs: 100, endMs: 60_000 },
    ]);
    expect(words).toEqual(["a"]);
  });

  it("gives every word when there is only one run", () => {
    expect(openingWords("all of it", [{ startMs: 0, endMs: 5000 }])).toEqual([
      "all",
      "of",
      "it",
    ]);
  });

  it("survives a take nobody could hear", () => {
    expect(openingWords("", runs)).toEqual([]);
    expect(openingWords("something", [])).toEqual(["something"]);
    expect(openingWords("something", [{ startMs: 5, endMs: 5 }])).toEqual(["something"]);
  });
});
