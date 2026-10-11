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
/**
 * How much speech this kind of film is built on.
 *
 * A typed way in to `editing.adaptiveSpeechMs`, which the compose stage uses
 * to decide how much room the pictures get. The capture surfaces need the same
 * two numbers to say anything honest about how a film is shaping up, and
 * neither should be reaching into an untyped `Record<string, unknown>` to get
 * them.
 *
 * Falls back to nothing rather than to invented defaults: a template that has
 * not said what it is built on should get silence, not a guess presented to a
 * customer as fact.
 */
export const speechAppetite = (
  template: Template,
): { readonly leanMs: number; readonly richMs: number } | undefined => {
  const declared = (template.editing as { adaptiveSpeechMs?: unknown }).adaptiveSpeechMs;
  if (typeof declared !== "object" || declared === null) return undefined;
  const { lean, rich } = declared as { lean?: unknown; rich?: unknown };
  if (typeof lean !== "number" || typeof rich !== "number" || rich <= lean) return undefined;
  return { leanMs: lean, richMs: rich };
};

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
  readonly chapterPrepare: readonly string[];
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
        chapterPrepare: chapter.prepare ?? [],
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

/**
 * Where the walk-through goes next.
 *
 * The capture flow is a wizard with an overview beside it: one screen at a
 * time, in the template's order, but never a corridor. Anything can be skipped,
 * any step can be opened from the overview, and coming back three days later
 * picks up at the first thing still to do. So "next" is never stored — it is
 * worked out from what is done, every time, which is what makes a reload, a
 * second device or the browser's Back button all land somewhere sensible.
 *
 * The three kinds of stop:
 *   - a chapter's intro, shown on the way INTO a chapter nobody has started,
 *     because "the interview needs two people and one sitting" has to be said
 *     before the first question rather than discovered after it;
 *   - a step;
 *   - the review, when nothing is left — the overview with the button that
 *     makes the film.
 */
export type WizardStop =
  | { readonly kind: "chapter"; readonly chapterId: string; readonly stepId: string }
  | { readonly kind: "step"; readonly stepId: string }
  | { readonly kind: "review" };

/** What navigation needs to know about a step, and nothing else. */
export type WizardStep = {
  readonly id: string;
  readonly chapterId: string;
  readonly done: boolean;
};

const stopFor = (
  steps: readonly WizardStep[],
  target: WizardStep,
  fromChapterId: string | null,
): WizardStop => {
  const enteringNewChapter = target.chapterId !== fromChapterId;
  const chapterUntouched = steps
    .filter((step) => step.chapterId === target.chapterId)
    .every((step) => !step.done);
  return enteringNewChapter && chapterUntouched
    ? { kind: "chapter", chapterId: target.chapterId, stepId: target.id }
    : { kind: "step", stepId: target.id };
};

/**
 * The stop after leaving `fromStepId` — whether it was just finished or
 * skipped, which is why the step itself is never a candidate.
 *
 * Forward first: the first unfinished step after this one. Then round from the
 * top, so somebody who skipped the photographs on day one is brought back to
 * them once the interview is done. Only when nothing at all is left is it the
 * review — and a skipped required step is still "left", so the review then
 * says what is missing rather than pretending the film is ready.
 *
 * `fromStepId` null means arriving from outside the wizard: the overview's
 * Continue, or pressing Start.
 */
export const nextStop = (
  steps: readonly WizardStep[],
  fromStepId: string | null,
): WizardStop => {
  const index = fromStepId === null ? -1 : steps.findIndex((step) => step.id === fromStepId);
  const from = index >= 0 ? steps[index] : undefined;
  const candidates = [...steps.slice(index + 1), ...steps.slice(0, Math.max(index, 0))];
  const target = candidates.find((step) => !step.done && step.id !== fromStepId);
  if (target === undefined) return { kind: "review" };
  return stopFor(steps, target, from?.chapterId ?? null);
};

/**
 * The first stop inside one chapter — what "Begin" on its intro does. The
 * first unfinished step in it, or its first step when all of it is done.
 */
export const chapterStart = (
  steps: readonly WizardStep[],
  chapterId: string,
): WizardStep | undefined => {
  const inChapter = steps.filter((step) => step.chapterId === chapterId);
  return inChapter.find((step) => !step.done) ?? inChapter[0];
};

/**
 * Back, one screen: the step before this one, whatever its state, since going
 * back is to look at something rather than to do it. Null from the very first
 * step, which goes back to the overview.
 */
export const previousStep = (
  steps: readonly WizardStep[],
  stepId: string,
): WizardStep | null => {
  const index = steps.findIndex((step) => step.id === stepId);
  return index > 0 ? (steps[index - 1] ?? null) : null;
};
