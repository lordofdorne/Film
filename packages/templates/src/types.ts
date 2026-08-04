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

export type Question = {
  readonly id: string;
  readonly order: number;
  readonly text: QuestionText;
  readonly narrativeRole: string;
  readonly required: boolean;
};

export type MediaSlot = {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly accepts?: readonly ("photo" | "video")[];
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
