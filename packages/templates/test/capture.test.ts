import { describe, expect, it } from "vitest";

import {
  LIFE_ADVICE_V1,
  resolveCaptureSteps,
  validateTemplate,
  type SubjectData,
  type Template,
} from "../src/index.js";

const SUBJECT: SubjectData = {
  subjectName: "Ada Lovelace",
  displayName: "Ada",
  age: 94,
  relationshipLabel: "grandmother",
  interviewerName: "Asim",
  interviewerRelationship: "grandson",
};

describe("resolveCaptureSteps", () => {
  it("asks for every required question and slot exactly once", () => {
    const steps = resolveCaptureSteps(LIFE_ADVICE_V1, SUBJECT);
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const question of LIFE_ADVICE_V1.questions) {
      if (question.required) expect(ids).toContain(question.id);
    }
    for (const slot of [...LIFE_ADVICE_V1.photoSlots, ...LIFE_ADVICE_V1.videoSlots]) {
      if (slot.required) expect(ids).toContain(slot.id);
    }
  });

  it("numbers steps across the whole walk-through, not within a chapter", () => {
    const steps = resolveCaptureSteps(LIFE_ADVICE_V1, SUBJECT);
    expect(steps.map((s) => s.number)).toEqual(steps.map((_, i) => i + 1));
    // More than one chapter, or the assertion above proves nothing.
    expect(new Set(steps.map((s) => s.chapterId)).size).toBeGreaterThan(1);
  });

  it("words a question for the subject in front of the camera", () => {
    const steps = resolveCaptureSteps(LIFE_ADVICE_V1, SUBJECT);
    const bonus = steps.find((s) => s.id === "bonus_interviewer");
    expect(bonus?.ask).toBe("What do you think of Asim, your grandson?");
  });

  it("uses the 100+ variant only when it is true of the subject", () => {
    const under = resolveCaptureSteps(LIFE_ADVICE_V1, SUBJECT).find((s) => s.id === "longevity");
    const over = resolveCaptureSteps(LIFE_ADVICE_V1, { ...SUBJECT, age: 101 }).find(
      (s) => s.id === "longevity",
    );
    expect(under?.ask).toBe("What is the secret to living a long life?");
    expect(over?.ask).toBe("What is the secret to living past 100?");
  });

  /**
   * The bonus question names the interviewer, and a project may not know one.
   * Showing someone "What do you think of , your ?" is worse than showing them
   * a plainer sentence, so guidance.ask is the fallback.
   */
  it("falls back to guidance when a question cannot be worded", () => {
    const nameless: SubjectData = { subjectName: "Ada", displayName: "Ada", age: 94 };
    const bonus = resolveCaptureSteps(LIFE_ADVICE_V1, nameless).find(
      (s) => s.id === "bonus_interviewer",
    );
    expect(bonus?.ask).toBe("Ask them what they think of you");
  });

  it("knows a photo step from a video step, and that the keepsake takes either", () => {
    const steps = resolveCaptureSteps(LIFE_ADVICE_V1, SUBJECT);
    const by = (id: string) => steps.find((s) => s.id === id);
    expect(by("photo_early")?.accepts).toEqual(["photo"]);
    expect(by("video_group")?.accepts).toEqual(["video"]);
    expect(by("keepsake")?.accepts).toEqual(["photo", "video"]);
    // An answer is a person talking, whatever else the template allows.
    expect(by("greatest_lesson")?.accepts).toEqual(["video"]);
  });

  it("carries the owner's coaching copy through to the step", () => {
    const early = resolveCaptureSteps(LIFE_ADVICE_V1, SUBJECT).find((s) => s.id === "photo_early");
    expect(early?.ask).toBe("Add a photo of the person from another time");
    expect(early?.examples?.length).toBeGreaterThan(0);
  });

  /**
   * The whole point of 3b: a project exists before anyone has said who it is
   * about, so every step must be wordable off an empty subject. This is the
   * verification the plan demanded before relying on the guidance.ask fallback.
   */
  it("words every step for a project with no subject at all", () => {
    const steps = resolveCaptureSteps(LIFE_ADVICE_V1, {});
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.ask.length, step.id).toBeGreaterThan(0);
      expect(step.ask, step.id).not.toContain("{{");
    }
  });

  it("resolves detail steps with their field, no media, and an input kind", () => {
    const steps = resolveCaptureSteps(LIFE_ADVICE_V1, {});
    const name = steps.find((s) => s.id === "subjectName");
    expect(name?.kind).toBe("detail");
    expect(name?.accepts).toEqual([]);
    expect(name?.field?.kind).toBe("text");
    expect(name?.field?.target).toBe("subject");
    const email = steps.find((s) => s.id === "ownerEmail");
    expect(email?.field?.kind).toBe("email");
    expect(email?.field?.target).toBe("owner");
  });

  it("gives every step an honest time estimate for the hub to sum", () => {
    for (const step of resolveCaptureSteps(LIFE_ADVICE_V1, SUBJECT)) {
      expect(step.estimatedSeconds, step.id).toBeGreaterThan(0);
    }
  });
});

describe("validateTemplate: the walk-through and the film cannot drift apart", () => {
  const withChapters = (steps: Template["capture"]["chapters"][number]["steps"]): Template => ({
    ...LIFE_ADVICE_V1,
    capture: { chapters: [{ id: "only", title: "Only", blurb: "", steps }] },
  });

  const messages = (t: Template): string[] => validateTemplate(t).map((i) => i.message);

  it("accepts the shipped template", () => {
    expect(validateTemplate(LIFE_ADVICE_V1).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("rejects a required question the walk-through never asks", () => {
    const short = LIFE_ADVICE_V1.capture.chapters.flatMap((c) => c.steps).filter(
      (s) => !(s.kind === "question" && s.questionId === "greatest_lesson"),
    );
    expect(messages(withChapters(short)).join("\n")).toContain(
      'question "greatest_lesson" is required but capture never asks it',
    );
  });

  it("rejects a required slot the walk-through never asks for", () => {
    const short = LIFE_ADVICE_V1.capture.chapters.flatMap((c) => c.steps).filter(
      (s) => !(s.kind === "slot" && s.slotId === "photo_group"),
    );
    expect(messages(withChapters(short)).join("\n")).toContain(
      'slot "photo_group" is required but capture never asks for it',
    );
  });

  it("rejects the same thing asked twice", () => {
    const all = LIFE_ADVICE_V1.capture.chapters.flatMap((c) => c.steps);
    const doubled = [...all, { kind: "slot" as const, slotId: "photo_early" }];
    expect(messages(withChapters(doubled)).join("\n")).toContain(
      'capture asks for "photo_early" 2 times',
    );
  });

  it("rejects a step that names something the template does not have", () => {
    const all = LIFE_ADVICE_V1.capture.chapters.flatMap((c) => c.steps);
    const bogus = [...all, { kind: "question" as const, questionId: "favourite_colour" }];
    expect(messages(withChapters(bogus)).join("\n")).toContain(
      'asks for question "favourite_colour", which is not defined',
    );
  });

  it("rejects a required detail the walk-through never asks for", () => {
    const short = LIFE_ADVICE_V1.capture.chapters.flatMap((c) => c.steps).filter(
      (s) => !(s.kind === "detail" && s.fieldId === "ownerEmail"),
    );
    expect(messages(withChapters(short)).join("\n")).toContain(
      'detail "ownerEmail" is required but capture never asks for it',
    );
  });

  it("rejects a detail step that names a field the template does not define", () => {
    const all = LIFE_ADVICE_V1.capture.chapters.flatMap((c) => c.steps);
    const bogus = [...all, { kind: "detail" as const, fieldId: "shoeSize" }];
    expect(messages(withChapters(bogus)).join("\n")).toContain(
      'asks for detail "shoeSize", which is not defined',
    );
  });

  /**
   * A film that cannot be worded is worse than one that cannot be started: it
   * fails at compose, hours after the customer has gone home. The walk-through
   * must collect every subject field the film's own text requires.
   */
  it("rejects a walk-through that could never fill the subject in", () => {
    const noName: Template = {
      ...LIFE_ADVICE_V1,
      details: LIFE_ADVICE_V1.details.filter((f) => f.id !== "subjectName"),
      capture: {
        chapters: LIFE_ADVICE_V1.capture.chapters.map((c) => ({
          ...c,
          steps: c.steps.filter((s) => !(s.kind === "detail" && s.fieldId === "subjectName")),
        })),
      },
    };
    expect(messages(noName).join("\n")).toContain(
      'subject field "subjectName" is required to word the film but no required detail step collects it',
    );
    // displayName is covered only through subjectName's prefill, so it goes too.
    expect(messages(noName).join("\n")).toContain('subject field "displayName"');
  });
});
