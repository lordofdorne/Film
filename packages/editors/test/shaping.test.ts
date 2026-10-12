import { describe, expect, it } from "vitest";

import { getTemplate } from "@film/templates";

import { LONG_PAUSE_MS, shapeAnswer, sharesFor, unitsOf } from "../src/shaping.js";
import type { TimedWord } from "../src/material.js";
import { talk } from "./talk.js";

const inSilence = (ms: number, words: readonly TimedWord[]): boolean =>
  !words.some((w) => ms > w.startMs && ms < w.endMs);
const length = (spans: readonly { startMs: number; endMs: number }[]): number =>
  spans.reduce((t, s) => t + s.endMs - s.startMs, 0);

describe("unitsOf", () => {
  it("closes a unit only on a sentence end that is also measured silence", () => {
    const { words } = talk(10);
    const units = unitsOf(words);
    for (const unit of units) {
      expect(unit.text).toMatch(/[.?!]$/);
      expect(inSilence(unit.startMs, words) && inSilence(unit.endMs, words)).toBe(true);
    }
    expect(units.map((u) => u.text).join(" ")).toBe(words.map((w) => w.text).join(" "));
  });

  it("keeps sentences said without a pause between them together", () => {
    const words: TimedWord[] = [
      { text: "One.", startMs: 0, endMs: 280 },
      { text: "Two.", startMs: 300, endMs: 580 }, // no silence before it
      { text: "Three.", startMs: 1_200, endMs: 1_480 },
    ];
    expect(unitsOf(words).map((u) => u.text)).toEqual(["One. Two.", "Three."]);
  });

  it("uses pauses as sentence ends when there is no punctuation at all", () => {
    const words: TimedWord[] = [
      { text: "one", startMs: 0, endMs: 280 },
      { text: "two", startMs: 300, endMs: 580 },
      { text: "three", startMs: 1_500, endMs: 1_780 },
    ];
    expect(unitsOf(words).map((u) => u.text)).toEqual(["one two", "three"]);
  });
});

describe("shapeAnswer", () => {
  it("leaves an answer within its share exactly as it was said", () => {
    const { words } = talk(3);
    const shaped = shapeAnswer(words, 60_000);
    expect(shaped.untouched).toBe(true);
    expect(shaped.spans).toEqual([{ startMs: words[0]?.startMs, endMs: words.at(-1)?.endMs }]);
  });

  it("takes out long pauses first, and keeps every word when that is enough", () => {
    const { words } = talk(6);
    const shaped = shapeAnswer(words, shapeAnswer(words, 0).spokenMs - 2_000);
    expect(shaped.untouched).toBe(false);
    expect(shaped.keptUnits).toBe(shaped.units);
    // Every word is still inside a kept stretch.
    for (const w of words) expect(shaped.spans.some((s) => w.startMs >= s.startMs && w.endMs <= s.endMs)).toBe(true);
    // And no kept stretch has a long pause inside it any more.
    for (const s of shaped.spans) {
      const inside = words.filter((w) => w.startMs >= s.startMs && w.endMs <= s.endMs);
      for (let i = 1; i < inside.length; i++) {
        expect((inside[i]?.startMs ?? 0) - (inside[i - 1]?.endMs ?? 0)).toBeLessThanOrEqual(LONG_PAUSE_MS);
      }
    }
  });

  it("then keeps whole sentences, in order, and fits the share", () => {
    const { words } = talk(10);
    const budget = 12_000;
    const shaped = shapeAnswer(words, budget);
    expect(shaped.keptUnits).toBeLessThan(shaped.units);
    expect(shaped.keptMs).toBeLessThanOrEqual(budget);
    for (let i = 1; i < shaped.spans.length; i++) {
      expect(shaped.spans[i]?.startMs ?? 0).toBeGreaterThan(shaped.spans[i - 1]?.endMs ?? 0);
    }
    // Never mid-word: every cut is in measured silence.
    for (const s of shaped.spans) {
      expect(inSilence(s.startMs, words) && inSilence(s.endMs, words)).toBe(true);
    }
  });

  it("keeps the opening, drops the restart, and keeps the marked phrase", () => {
    const { words } = talk(10);
    const shaped = shapeAnswer(words, 15_000, "be kind while you do");
    const kept = words
      .filter((w) => shaped.spans.some((s) => w.startMs >= s.startMs && w.endMs <= s.endMs))
      .map((w) => w.text)
      .join(" ");
    expect(kept.startsWith("We grew up in a small house by the river.")).toBe(true);
    expect(kept).not.toContain("Um, you know");
    expect(kept).toContain("Give it everything, and be kind while you do.");
  });

  it("keeps the first thought whole even when it alone is over the share", () => {
    const { words } = talk(1);
    const shaped = shapeAnswer(words, 1_000);
    expect(length(shaped.spans)).toBeGreaterThan(1_000);
    expect(shaped.keptUnits).toBe(1);
  });
});

describe("sharesFor", () => {
  const template = getTemplate("life-advice", 1);
  const required = template.questions.filter((q) => q.required).map((q) => q.id);
  const sum = (m: ReadonlyMap<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

  it("gives the required answers their shares as written", () => {
    const shares = sharesFor(template, new Set(required));
    expect(shares.get("greatest_lesson")).toBe(45_000);
    expect(shares.get("closing_message")).toBe(30_000);
    expect(shares.has("bonus_interviewer")).toBe(false);
  });

  it("shrinks every share when the optional bonus is given, so the film is no longer", () => {
    const without = sharesFor(template, new Set(required));
    const withBonus = sharesFor(template, new Set([...required, "bonus_interviewer"]));
    expect(withBonus.has("bonus_interviewer")).toBe(true);
    expect(Math.abs(sum(withBonus) - sum(without))).toBeLessThanOrEqual(withBonus.size);
    expect(withBonus.get("greatest_lesson")).toBeLessThan(45_000);
    // In proportion: the greatest lesson is still the largest.
    expect(Math.max(...withBonus.values())).toBe(withBonus.get("greatest_lesson"));
  });
});
