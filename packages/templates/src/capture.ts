import type { PartialSubject } from "./interpolate.js";
import { resolveQuestionText } from "./interpolate.js";
import type { CaptureChapter, DetailField, Guidance, MediaSlot, Template } from "./types.js";

/**
 * The walk-through, resolved for one subject.
 *
 * The web app renders these and nothing else — it never reaches into
 * `questions` or `photoSlots`, and it never contains a string that only makes
 * sense for one film type. That is the whole test of this boundary: a second
 * template ships its own walk-through with no React changing.
 */
export type ResolvedCaptureStep = {
  /** The id in the URL. A question, slot or field id; unique across the flow. */
  readonly id: string;
  readonly kind: "question" | "slot" | "detail";
  /** Exactly one of these three is set, and it is what the answer binds to. */
  readonly questionId?: string;
  readonly slotId?: string;
  /** A detail step carries its whole field: the step sheet needs the input
   *  kind and saveDetail needs the target, and neither may guess. */
  readonly field?: DetailField;
  /** What may be given here. A question always wants a recorded answer; a
   *  detail wants no media at all. */
  readonly accepts: readonly ("photo" | "video")[];
  readonly required: boolean;
  /** The big line: the question to ask aloud, or the thing to go and find. */
  readonly ask: string;
  readonly coaching?: string;
  readonly examples?: readonly string[];
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterBlurb: string;
  /** 1-based, across the whole walk-through rather than within the chapter. */
  readonly number: number;
  /** The template's honest guess, summed by the hub into time remaining. */
  readonly estimatedSeconds: number;
};

const slotsOf = (template: Template): readonly MediaSlot[] => [
  ...template.photoSlots,
  ...template.videoSlots,
  ...template.optionalSlots,
];

/** Photos and video default by which array the slot was declared in. */
const acceptsOf = (template: Template, slot: MediaSlot): readonly ("photo" | "video")[] => {
  if (slot.accepts !== undefined) return slot.accepts;
  return template.photoSlots.includes(slot) ? ["photo"] : ["video"];
};

const guidanceOf = (g: Guidance | undefined): Pick<ResolvedCaptureStep, "coaching" | "examples"> => ({
  ...(g?.coaching === undefined ? {} : { coaching: g.coaching }),
  ...(g?.examples === undefined ? {} : { examples: g.examples }),
});

/**
 * Every step, in order, with its wording already decided.
 *
 * The subject matters because question wording can depend on it — a
 * centenarian is asked a different longevity question, and the bonus question
 * names the interviewer. When a question's wording needs a token the project
 * does not have, `guidance.ask` is the fallback rather than showing someone a
 * sentence with a hole in it.
 */
export const resolveCaptureSteps = (
  template: Template,
  subject: PartialSubject,
): readonly ResolvedCaptureStep[] => {
  const questions = new Map(template.questions.map((q) => [q.id, q]));
  const slots = new Map(slotsOf(template).map((s) => [s.id, s]));
  const fields = new Map(template.details.map((f) => [f.id, f]));
  const steps: ResolvedCaptureStep[] = [];

  for (const chapter of template.capture.chapters) {
    for (const ref of chapter.steps) {
      const chapterFields = {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterBlurb: chapter.blurb,
        number: steps.length + 1,
      };

      if (ref.kind === "detail") {
        const field = fields.get(ref.fieldId);
        if (field === undefined) {
          throw new Error(
            `${template.id}@${String(template.version)} capture references unknown detail "${ref.fieldId}"`,
          );
        }
        steps.push({
          id: field.id,
          kind: "detail",
          field,
          accepts: [],
          required: field.required,
          ask: field.guidance.ask,
          ...guidanceOf(field.guidance),
          ...chapterFields,
          estimatedSeconds: field.estimatedSeconds,
        });
        continue;
      }

      if (ref.kind === "question") {
        const question = questions.get(ref.questionId);
        if (question === undefined) {
          throw new Error(
            `${template.id}@${String(template.version)} capture references unknown question "${ref.questionId}"`,
          );
        }
        const wording = resolveQuestionText(question, subject, template);
        const ask = wording.ok ? wording.text : question.guidance?.ask;
        if (ask === undefined) {
          throw new Error(
            `question "${question.id}" cannot be worded for this subject and has no guidance.ask: ` +
              (wording.ok ? "" : wording.detail),
          );
        }
        steps.push({
          id: question.id,
          kind: "question",
          questionId: question.id,
          // An answer is always a recording of a person talking.
          accepts: ["video"],
          required: question.required,
          ask,
          ...guidanceOf(question.guidance),
          ...chapterFields,
          estimatedSeconds: question.estimatedSeconds,
        });
        continue;
      }

      const slot = slots.get(ref.slotId);
      if (slot === undefined) {
        throw new Error(
          `${template.id}@${String(template.version)} capture references unknown slot "${ref.slotId}"`,
        );
      }
      steps.push({
        id: slot.id,
        kind: "slot",
        slotId: slot.id,
        accepts: acceptsOf(template, slot),
        required: slot.required,
        ask: slot.guidance?.ask ?? slot.label,
        ...guidanceOf(slot.guidance),
        ...chapterFields,
        estimatedSeconds: slot.estimatedSeconds,
      });
    }
  }

  return steps;
};

/** The chapters, for a walk-through that shows where it is going. */
export const captureChapters = (template: Template): readonly CaptureChapter[] =>
  template.capture.chapters;
