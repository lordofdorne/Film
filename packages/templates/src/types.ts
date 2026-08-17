import type { TemplateConformance } from "@film/edl";

/**
 * A question's wording may vary with the subject. The condition is a tiny
 * fixed grammar ("subject.age >= 100"), evaluated by a parser — not by eval,
 * and not by anything that could grow into a general expression language.
 */
export type QuestionTextVariant = {
  readonly when: string;
  readonly text: string;
};

export type QuestionText =
  | string
  | { readonly default: string; readonly variants: readonly QuestionTextVariant[] };

/**
 * What to ask someone for, and how to get a good one.
 *
 * The film is only as good as what people give us, and what they give us
 * depends almost entirely on what we asked for. "Add a photo" gets a
 * screenshot; "Add a photo of the person from another time" gets the one from
 * 1974. This is the cheapest lever on output quality in the whole system, and
 * it costs a string.
 *
 * It lives here rather than in the web app for the same reason every other
 * template rule does: a second film type must ship its own walk-through
 * without a line of React changing.
 */
export type Guidance = {
  /**
   * Imperative, one line: the thing we want.
   *
   * Optional on a question, where the question's own wording is already the
   * ask and repeating it here would be two copies that can drift apart. Supply
   * it only when the on-screen ask must differ — or as the fallback when the
   * question's wording depends on a token the project may not have.
   */
  readonly ask?: string;
  /** How to get a good one. Shown under the ask, quieter. */
  readonly coaching?: string;
  /** Two or three. A short list is a suggestion; six is a form. */
  readonly examples?: readonly string[];
};

export type Question = {
  readonly id: string;
  readonly order: number;
  readonly text: QuestionText;
  readonly narrativeRole: string;
  readonly required: boolean;
  /** The question itself is the ask, so this is coaching for the person
   *  holding the camera. `guidance.ask` overrides the question wording only
   *  when the two must differ. */
  readonly guidance?: Guidance;
  /** An honest guess at how long this takes to give, including the retake
   *  somebody usually wants. Content, not code: the hub sums these to say how
   *  much is left, and a wrong number here is a lie on that screen. */
  readonly estimatedSeconds: number;
};

export type MediaSlot = {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly accepts?: readonly ("photo" | "video")[];
  readonly guidance?: Guidance;
  readonly estimatedSeconds: number;
};

/**
 * A typed answer the film needs — a name, an age, an address.
 *
 * These are steps in the walk-through, not a form on the way in. "What do you
 * call them?" is a card in the hub next to "Add a photo of the person from
 * another time"; one opens a text field and the other opens a camera, and both
 * are things the film needs. The wording lives here for the same reason all
 * guidance does: a second film type ships its own walk-through with no React
 * changing.
 */
export type DetailField = {
  /** For `target: "subject"`, a SubjectData key; it is written verbatim. */
  readonly id: string;
  readonly kind: "text" | "number" | "email";
  readonly required: boolean;
  /** `ask` is mandatory here — a typed field has no question wording to lean on. */
  readonly guidance: Guidance & { readonly ask: string };
  /** Where the answer lands: the subject record, or the project's owner. */
  readonly target: "subject" | "owner";
  /**
   * Subject fields this answer also fills when they are still empty.
   *
   * How "Who is this film for?" satisfies `displayName` without a second
   * required card: most people call their grandmother what everyone calls her,
   * and the one who says "Nana" can still change it on the optional step.
   */
  readonly prefills?: readonly string[];
  readonly estimatedSeconds: number;
};

/** One thing the walk-through asks for, in the order it asks. */
export type CaptureStepRef =
  | { readonly kind: "question"; readonly questionId: string }
  | { readonly kind: "slot"; readonly slotId: string }
  | { readonly kind: "detail"; readonly fieldId: string };

/**
 * A run of steps that belong together, with a break between chapters.
 *
 * The break carries weight: the interview needs two people and one sitting,
 * while the photographs can be gathered on a sofa a week later. Nobody should
 * have to hold an elderly relative in a chair while someone hunts for a print.
 */
export type CaptureChapter = {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly steps: readonly CaptureStepRef[];
};

/** Where a structural beat gets its content. */
export type BeatSource =
  | { readonly kind: "title"; readonly textKey: string }
  | { readonly kind: "slot"; readonly slotId: string; readonly fallbackSlotId?: string }
  | {
      readonly kind: "question";
      readonly questionId: string;
      /** 2 marks a second, later excerpt of an answer already used earlier. */
      readonly range?: 1 | 2;
      readonly optional?: boolean;
    }
  | { readonly kind: "questions"; readonly questionIds: readonly string[] };

export type TextConfig = {
  readonly titleNoun: string;
  readonly keys: Readonly<Record<string, string>>;
  /** Used when the primary pattern has an unresolvable token. */
  readonly fallbacks: Readonly<Record<string, string>>;
};

export type CaptionPolicy = "all-speech" | "interview-only" | "emphasis-only";
export type QuestionPromptMode = "live-interviewer" | "recorded-interviewer" | "text-only";

export type Template = {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
  readonly formatIds: readonly string[];
  readonly defaultFormatId: string;
  readonly targetDurationMs: { readonly min: number; readonly max: number };
  readonly structure: readonly string[];
  readonly beatSources: Readonly<Record<string, BeatSource>>;
  readonly questions: readonly Question[];
  readonly questionPrompt: {
    readonly defaultMode: QuestionPromptMode;
    readonly supportedModes: readonly QuestionPromptMode[];
    /** Silence between the completed question treatment and the answer. */
    readonly answerGapMs: number;
  };
  readonly photoSlots: readonly MediaSlot[];
  readonly videoSlots: readonly MediaSlot[];
  readonly optionalSlots: readonly MediaSlot[];
  /** The typed answers this film needs, in the same shape as everything else
   *  the customer reads. */
  readonly details: readonly DetailField[];
  /**
   * The walk-through, as an explicit ordered list rather than one derived from
   * `questions[].order` plus the slot arrays.
   *
   * The order someone records in is a different concern from the order the
   * film cuts in, and it must be changeable without touching the film's
   * structure. The cost is that it can fall out of sync, which is what
   * `validateTemplate` checks.
   */
  readonly capture: { readonly chapters: readonly CaptureChapter[] };
  readonly text: TextConfig;
  readonly editing: Readonly<Record<string, unknown>>;
  readonly conformance: {
    readonly maxEmphasisPerFilm: number;
    readonly maxConsecutivePhotos: number;
    readonly requiredPhotoSlotIds: readonly string[];
    readonly requiredVideoSlotIds: readonly string[];
  };
  readonly audioDefaults: {
    readonly musicGainDb: number;
    readonly duckDb: number;
    readonly duckAttackMs: number;
    readonly duckReleaseMs: number;
  };
  readonly styling: TemplateStyling;
  readonly musicOptions: readonly string[];
  readonly defaultMusicTrackId: string;
};

export type TextStyle = {
  readonly weight: number;
  /** Fraction of composition height, so type scales with format. */
  readonly sizeVh: number;
  readonly tracking: number;
  readonly fill: string;
};

export type TemplateStyling = {
  readonly fontFamily: string;
  readonly captionPolicy: CaptionPolicy;
  readonly caption: TextStyle & {
    readonly shadow: string;
    readonly maxLines: number;
    readonly bottomInsetVh: number;
  };
  readonly question: TextStyle & {
    readonly shadow: string;
    readonly revealFadeMs: number;
  };
  readonly title: TextStyle & {
    readonly background: string;
    readonly revealPerWordMs: number;
    readonly revealFadeMs: number;
  };
  readonly overlay: TextStyle & { readonly shadow: string };
  readonly emphasis: Omit<TextStyle, "fill"> & {
    readonly toneFill: Readonly<Record<"funny" | "meaningful" | "surprising", string>>;
    readonly shadow: string;
    readonly riseMs: number;
    readonly holdScale: number;
  };
};

/** Adapter: the slice of a template the EDL validator needs, as plain data. */
export const toConformance = (t: Template): TemplateConformance => ({
  templateId: t.id,
  templateVersion: t.version,
  maxEmphasisPerFilm: t.conformance.maxEmphasisPerFilm,
  maxConsecutivePhotos: t.conformance.maxConsecutivePhotos,
  requiredPhotoSlotIds: t.conformance.requiredPhotoSlotIds,
  requiredVideoSlotIds: t.conformance.requiredVideoSlotIds,
  questionIds: t.questions.map((q) => q.id),
  interviewScales: (t.editing["interviewScales"] as readonly number[] | undefined) ?? [1],
  minPromptAnswerGapMs: t.questionPrompt.answerGapMs,
  targetDurationMs: t.targetDurationMs,
});
