import { describe, expect, it } from "vitest";

import { resolveCaptureSteps, TEMPLATE_REGISTRY, type SubjectData, type Template } from "../src/index.js";
import { clock, spokenRange, takeZone, validTakeLength, type TakeLength } from "../src/take.js";

const SUBJECT: SubjectData = {
  subjectName: "Ada Lovelace",
  displayName: "Ada",
  age: 94,
  relationshipLabel: "grandmother",
  interviewerName: "Asim",
  interviewerRelationship: "grandson",
};

const EVERY_TEMPLATE: readonly (readonly [string, Template])[] = Object.values(TEMPLATE_REGISTRY).flatMap(
  (versions) => Object.values(versions).map((t: Template) => [`${t.id}@${String(t.version)}`, t] as const),
);

const ANSWER: TakeLength = { goodFrom: 30, goodTo: 90, max: 150 };

describe("takeZone", () => {
  it("walks short → good → plenty → ending → max as the seconds go up", () => {
    expect(takeZone(0, ANSWER)).toBe("short");
    expect(takeZone(29, ANSWER)).toBe("short");
    expect(takeZone(30, ANSWER)).toBe("good");
    expect(takeZone(89, ANSWER)).toBe("good");
    expect(takeZone(90, ANSWER)).toBe("plenty");
    expect(takeZone(134, ANSWER)).toBe("plenty");
    expect(takeZone(135, ANSWER)).toBe("ending");
    expect(takeZone(149, ANSWER)).toBe("ending");
    expect(takeZone(150, ANSWER)).toBe("max");
  });

  it("never counts down inside the good range, however close max is", () => {
    // A clip whose good range runs to within the warning of its end.
    const clip: TakeLength = { goodFrom: 8, goodTo: 20, max: 30 };
    expect(takeZone(16, clip)).toBe("good");
    expect(takeZone(20, clip)).toBe("ending");
  });
});

describe("words for it", () => {
  it("says the clock the way the timer shows it", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(9.7)).toBe("0:09");
    expect(clock(150)).toBe("2:30");
  });

  it("says a range the way a person would", () => {
    expect(spokenRange({ goodFrom: 3, goodTo: 20, max: 30 })).toBe("3 to 20 seconds");
    expect(spokenRange(ANSWER)).toBe("30 seconds to a minute and a half");
    expect(spokenRange({ goodFrom: 45, goodTo: 120, max: 180 })).toBe("45 seconds to 2 minutes");
  });
});

describe("every template", () => {
  it.each(EVERY_TEMPLATE)(
    "%s gives every recorded step a sensible length",
    (_name, template) => {
      for (const step of resolveCaptureSteps(template, SUBJECT)) {
        if (!step.accepts.includes("video")) continue;
        expect(step.take, `${step.id} records but has no take length`).toBeDefined();
        if (step.take !== undefined) expect(validTakeLength(step.take), step.id).toBe(true);
      }
    },
  );
});
