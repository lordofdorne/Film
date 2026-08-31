import { LANDSCAPE_CLASSIC, getFormat } from "@film/formats";
import { PLACEHOLDER_TRACK, buildBeatGrid, resolveTrack } from "@film/music";
import { describe, expect, it } from "vitest";
import {
  LIFE_ADVICE_V1,
  evaluateCondition,
  getTemplate,
  interpolate,
  questionCardIds,
  resolveAllText,
  resolveQuestionText,
  resolveText,
  toConformance,
  validateTemplate,
  type SubjectData,
} from "../src/index.js";

const NANA: SubjectData = {
  subjectName: "Eleanor Grace Whitfield",
  displayName: "Nana",
  age: 94,
  relationshipLabel: "grandmother",
  interviewerName: "Margaret",
  interviewerRelationship: "granddaughter",
};

describe("template registry", () => {
  it("resolves life-advice@1 and rejects anything else", () => {
    expect(getTemplate("life-advice", 1)).toBe(LIFE_ADVICE_V1);
    expect(() => getTemplate("life-advice", 2)).toThrow(/unknown template/);
    expect(() => getTemplate("wedding", 1)).toThrow(/unknown template/);
  });

  it("is internally consistent", () => {
    const issues = validateTemplate(LIFE_ADVICE_V1);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports the three uncommissioned tracks as pending, not as errors", () => {
    const warnings = validateTemplate(LIFE_ADVICE_V1).filter((i) => i.severity === "warning");
    expect(warnings).toHaveLength(3);
    expect(warnings.every((w) => /not commissioned yet/.test(w.message))).toBe(true);
  });

  it("sources every structural beat", () => {
    for (const beat of LIFE_ADVICE_V1.structure) {
      expect(LIFE_ADVICE_V1.beatSources[beat], `beat "${beat}"`).toBeDefined();
    }
  });

  it("asks ten questions, nine of them required", () => {
    expect(LIFE_ADVICE_V1.questions).toHaveLength(10);
    expect(LIFE_ADVICE_V1.questions.filter((q) => q.required)).toHaveLength(9);
  });

  it("supports all three interviewer question treatments", () => {
    expect(LIFE_ADVICE_V1.questionPrompt.defaultMode).toBe("live-interviewer");
    expect(new Set(LIFE_ADVICE_V1.questionPrompt.supportedModes)).toEqual(
      new Set(["live-interviewer", "recorded-interviewer", "text-only"]),
    );
  });

  it("exposes conformance the EDL validator can consume without importing this package", () => {
    const c = toConformance(LIFE_ADVICE_V1);
    expect(c.templateId).toBe("life-advice");
    expect(c.interviewScales).toEqual([1, 1.06, 1.1]);
    expect(c.questionIds).toContain("love_lesson");
    expect(c.questionIds).toContain("closing_message");
  });
});

describe("text interpolation", () => {
  it("resolves the opening line for a subject with a relationship label", () => {
    const r = resolveText(LIFE_ADVICE_V1, "opening", NANA, LANDSCAPE_CLASSIC);
    expect(r).toMatchObject({
      ok: true,
      text: "I interviewed my 94 year old grandmother",
      usedFallback: false,
    });
  });

  it("falls back rather than rendering undefined when the label is missing", () => {
    const { relationshipLabel: _omitted, ...noLabel } = NANA;
    const r = resolveText(LIFE_ADVICE_V1, "opening", noLabel, LANDSCAPE_CLASSIC);
    expect(r).toMatchObject({
      ok: true,
      text: "I interviewed Nana, who is 94 years old",
      usedFallback: true,
    });
  });

  it("never emits the string 'undefined' for any missing optional field", () => {
    const bare: SubjectData = {
      subjectName: "Eleanor Grace Whitfield",
      displayName: "Nana",
      age: 94,
    };
    const all = resolveAllText(LIFE_ADVICE_V1, bare, LANDSCAPE_CLASSIC);
    expect(all.ok).toBe(true);
    if (all.ok) {
      for (const [key, text] of Object.entries(all.text)) {
        expect(text, key).not.toMatch(/undefined|\{\{/);
      }
    }
  });

  it("resolves the main title and its end-title callback identically", () => {
    const main = resolveText(LIFE_ADVICE_V1, "mainTitle", NANA, LANDSCAPE_CLASSIC);
    const end = resolveText(LIFE_ADVICE_V1, "endTitle", NANA, LANDSCAPE_CLASSIC);
    expect(main).toMatchObject({ ok: true, text: "94 years of stories" });
    expect(end).toMatchObject({ ok: true, text: "94 years of stories" });
  });

  it("fails rather than truncating a title that will not fit", () => {
    const longLabel: SubjectData = {
      ...NANA,
      relationshipLabel: "great-great-grandmother on my mother's side of the family",
    };
    const r = resolveText(LIFE_ADVICE_V1, "opening", longLabel, LANDSCAPE_CLASSIC);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("too-long");
      expect(r.detail).toContain(String(LANDSCAPE_CLASSIC.titleMaxChars));
    }
  });

  /**
   * TITLES, and only titles.
   *
   * `resolveAllText` also emits a key per question so a question card can name
   * one, and a question is a sentence rather than a title — "What would you
   * like to say to whoever watches this?" is 51 characters against a 48
   * character title budget, and shortening the product's best question to fit
   * a constraint that does not apply to it would be the wrong way round. The
   * card sets them in the question treatment for exactly this reason.
   */
  it("every resolved title fits the format", () => {
    const all = resolveAllText(LIFE_ADVICE_V1, NANA, LANDSCAPE_CLASSIC);
    expect(all.ok).toBe(true);
    if (all.ok) {
      for (const key of Object.keys(LIFE_ADVICE_V1.text.keys)) {
        const text = all.text[key] ?? "";
        expect(text.length, `${key}: "${text}"`).toBeLessThanOrEqual(
          LANDSCAPE_CLASSIC.titleMaxChars,
        );
      }
    }
  });

  it("resolves a card's worth of text for every question", () => {
    const all = resolveAllText(LIFE_ADVICE_V1, NANA, LANDSCAPE_CLASSIC);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.text["question:greatest_lesson"]).toBe(
      "What is the greatest lesson life has taught you?",
    );
    // Conditional wording resolves here too, not just through resolveQuestionText.
    const old = resolveAllText(LIFE_ADVICE_V1, { ...NANA, age: 101 }, LANDSCAPE_CLASSIC);
    if (old.ok) {
      expect(old.text["question:longevity"]).toBe("What is the secret to living past 100?");
    }
  });
});

/**
 * Which questions the film puts on a card.
 *
 * Two filters, and the film breaks differently without each. Skip the role
 * filter and the film asks "What is your name?" on screen immediately after
 * the title card that answers it. Skip the resolves filter and compose emits a
 * card whose text key `resolveAllText` deliberately left out, which is a render
 * that throws rather than a card that is missing.
 */
describe("questionCardIds", () => {
  it("leaves out the introduction, which the title card already answers", () => {
    const ids = questionCardIds(LIFE_ADVICE_V1, NANA);
    expect(ids).not.toContain("identity_name");
    expect(ids).not.toContain("identity_age");
    expect(ids).not.toContain("identity_birth_year");
    expect(ids).toContain("greatest_lesson");
    expect(ids).toContain("closing_message");
  });

  /**
   * The bonus question is "What do you think of {{interviewerName}}, your
   * {{interviewerRelationship}}?" — most films have neither, and a card cannot
   * be drawn for a question nobody can word.
   */
  it("leaves out a question whose wording this subject cannot fill in", () => {
    const { interviewerName: _n, interviewerRelationship: _r, ...anonymous } = NANA;
    expect(questionCardIds(LIFE_ADVICE_V1, NANA)).toContain("bonus_interviewer");
    expect(questionCardIds(LIFE_ADVICE_V1, anonymous)).not.toContain("bonus_interviewer");

    // And the key really is absent, which is what makes the filter necessary.
    const all = resolveAllText(LIFE_ADVICE_V1, anonymous, LANDSCAPE_CLASSIC);
    if (all.ok) expect(all.text["question:bonus_interviewer"]).toBeUndefined();
  });

  it("reports missing tokens instead of substituting empty strings", () => {
    expect(interpolate("hello {{name}}", {})).toEqual({ ok: false, missing: ["name"] });
    expect(interpolate("hello {{name}}", { name: "" })).toEqual({ ok: false, missing: ["name"] });
    expect(interpolate("hello {{name}}", { name: "world" })).toEqual({
      ok: true,
      text: "hello world",
    });
  });
});

describe("conditional question wording", () => {
  it("asks the ordinary longevity question of a 94 year old", () => {
    const q = LIFE_ADVICE_V1.questions.find((x) => x.id === "longevity");
    expect(q).toBeDefined();
    expect(resolveQuestionText(q!, NANA, LIFE_ADVICE_V1)).toMatchObject({
      ok: true,
      text: "What is the secret to living a long life?",
    });
  });

  it("asks the centenarian variant only when it is true of the subject", () => {
    const q = LIFE_ADVICE_V1.questions.find((x) => x.id === "longevity");
    expect(resolveQuestionText(q!, { ...NANA, age: 101 }, LIFE_ADVICE_V1)).toMatchObject({
      ok: true,
      text: "What is the secret to living past 100?",
    });
    // Exactly 100 satisfies ">= 100".
    expect(resolveQuestionText(q!, { ...NANA, age: 100 }, LIFE_ADVICE_V1)).toMatchObject({
      text: "What is the secret to living past 100?",
    });
    expect(resolveQuestionText(q!, { ...NANA, age: 99 }, LIFE_ADVICE_V1)).toMatchObject({
      text: "What is the secret to living a long life?",
    });
  });

  it("interpolates the bonus question from interviewer details", () => {
    const q = LIFE_ADVICE_V1.questions.find((x) => x.id === "bonus_interviewer");
    expect(resolveQuestionText(q!, NANA, LIFE_ADVICE_V1)).toMatchObject({
      ok: true,
      text: "What do you think of Margaret, your granddaughter?",
    });
  });

  it("refuses the bonus question when interviewer details are absent", () => {
    const q = LIFE_ADVICE_V1.questions.find((x) => x.id === "bonus_interviewer");
    const bare: SubjectData = { subjectName: "E", displayName: "Nana", age: 94 };
    const r = resolveQuestionText(q!, bare, LIFE_ADVICE_V1);
    expect(r.ok).toBe(false);
  });

  it("rejects anything outside the tiny condition grammar", () => {
    expect(evaluateCondition("subject.age >= 100", NANA)).toBe(false);
    expect(evaluateCondition("subject.age < 100", NANA)).toBe(true);
    // Not an expression language, and emphatically not eval.
    for (const hostile of [
      "process.exit(1)",
      "subject.age >= 100 || true",
      "subject['age'] >= 100",
      "1 === 1",
    ]) {
      expect(() => evaluateCondition(hostile, NANA), hostile).toThrow(/unsupported condition/);
    }
  });

  it("treats a non-numeric field as not matching rather than throwing", () => {
    expect(evaluateCondition("subject.displayName >= 100", NANA)).toBe(false);
  });
});

describe("formats and music", () => {
  it("registers landscape-classic only", () => {
    expect(getFormat("landscape-classic")).toBe(LANDSCAPE_CLASSIC);
    expect(() => getFormat("vertical")).toThrow(/unknown format/);
  });

  it("builds a frame-exact 75bpm downbeat grid", () => {
    const grid = buildBeatGrid(240_000, 3200);
    expect(grid).toHaveLength(75);
    expect(grid[0]).toBe(0);
    expect(grid.at(-1)).toBe(236_800);
    // Every downbeat lands on a whole frame at 30fps.
    expect(grid.every((ms) => Number.isInteger((ms * 30) / 1000))).toBe(true);
  });

  it("keeps the placeholder track unavailable to customers", () => {
    expect(PLACEHOLDER_TRACK.available).toBe(false);
    expect(PLACEHOLDER_TRACK.usage).toBe("fixture-only");
    expect(resolveTrack("placeholder-tone-bed")).toBe(PLACEHOLDER_TRACK);
  });

  it("has every cue inside the track", () => {
    const { cues, durationMs } = PLACEHOLDER_TRACK;
    for (const t of [cues.openingMs, cues.titleMs, cues.resolutionMs, cues.endingMs, ...cues.lifts]) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(durationMs);
    }
  });

  it("exposes no reference-only track as a selectable asset", () => {
    expect(resolveTrack("end-of-august")).toBeUndefined();
  });
});
