import { describe, expect, it } from "vitest";

import { getTemplate, speechAppetite } from "@film/templates";

import { medianSeconds, spokenVerdict } from "../src/capture.js";

/**
 * Whether to say anything about how long an answer was.
 *
 * The whole risk in this feature is tone. "Never feeling trapped" is one of
 * the four things this product has to feel like, and a screen that tells
 * somebody their answer about their mother was not good enough is worse than
 * a short film. So the rule is deliberately quiet: it speaks when an answer is
 * short FOR THIS PERSON, and otherwise says the reassuring thing.
 */
describe("spokenVerdict", () => {
  it("says nothing useful was heard when almost nothing was", () => {
    expect(spokenVerdict(1, 20)).toBe("inaudible");
  });

  /**
   * The case that would ruin it. "What is your name?" is a four-second answer
   * and always will be; somebody whose whole conversation is brief is having a
   * brief conversation, not making a mistake.
   */
  it("leaves a short answer alone when every answer is short", () => {
    expect(spokenVerdict(4, 5)).toBe("clear");
    expect(spokenVerdict(6, 8)).toBe("clear");
    expect(spokenVerdict(9, 9)).toBe("clear");
  });

  it("speaks up when one answer is far shorter than that person's others", () => {
    // Thirty-second answers, then four seconds: probably interrupted.
    expect(spokenVerdict(4, 30)).toBe("short");
    expect(spokenVerdict(3, 25)).toBe("short");
  });

  it("stays quiet when the answer is merely below the middle", () => {
    // Half of their median is still a real answer.
    expect(spokenVerdict(15, 30)).toBe("clear");
    expect(spokenVerdict(11, 30)).toBe("clear");
  });

  it("always speaks below the floor, however brief the rest were", () => {
    expect(spokenVerdict(2.5, 3)).toBe("short");
  });

  it("has nothing to compare against on the first answer", () => {
    // A median of zero is "we have not seen enough of you yet".
    expect(spokenVerdict(6, 0)).toBe("clear");
  });
});

describe("medianSeconds", () => {
  it("is the middle, so one long answer does not shame the rest", () => {
    expect(medianSeconds([4, 5, 6, 7, 120])).toBe(6);
  });

  it("averages the two middles for an even count", () => {
    expect(medianSeconds([4, 6, 8, 10])).toBe(7);
  });

  it("is zero when nothing has been recorded", () => {
    expect(medianSeconds([])).toBe(0);
  });
});

/**
 * What a film is built on, read from the template rather than guessed.
 *
 * `speechAppetite` is the one number the compose stage and the capture
 * surfaces have to agree about: compose uses it to decide how much room the
 * pictures get, and the hub uses it to say anything honest about how a film is
 * shaping up. If the two ever read different numbers, the screen and the film
 * disagree about the same recording.
 */
describe("speechAppetite", () => {
  it("reads what the template declares", () => {
    const appetite = speechAppetite(getTemplate("life-advice", 1));
    expect(appetite).toBeDefined();
    expect(appetite?.leanMs).toBeGreaterThan(0);
    expect(appetite?.richMs).toBeGreaterThan(appetite?.leanMs ?? 0);
  });

  /**
   * Silence rather than a guess. A template that has not said what it is built
   * on should not have a number invented for it and shown to a customer as
   * though it were the template's own.
   */
  it("says nothing when a template has not declared it", () => {
    const template = getTemplate("life-advice", 1);
    const without = { ...template, editing: {} } as typeof template;
    expect(speechAppetite(without)).toBeUndefined();

    const nonsense = {
      ...template,
      editing: { adaptiveSpeechMs: { lean: 200, rich: 100 } },
    } as typeof template;
    expect(speechAppetite(nonsense)).toBeUndefined();
  });
});
