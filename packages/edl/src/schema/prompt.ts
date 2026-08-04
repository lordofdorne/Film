import { z } from "zod";
import { Id, MsInt, MsPositive } from "./primitives.js";
import { WordCaptionSchema } from "./speech.js";

const basePrompt = {
  id: Id,
  questionId: Id,
  startMs: MsInt,
  durationMs: MsPositive,
  /** Timings are relative to this prompt and drive the question-text reveal. */
  captions: z.array(WordCaptionSchema).min(1),
};

/** A question shown on screen without an interviewer recording. */
export const TextOnlyPromptSegmentSchema = z
  .object({
    ...basePrompt,
    mode: z.literal("text-only"),
  })
  .strict();

const recordedPrompt = {
  ...basePrompt,
  assetId: Id,
  sourceInMs: MsInt,
  sourceOutMs: MsPositive,
};

/** The off-screen question and answer were captured in the same video take. */
export const LiveInterviewerPromptSegmentSchema = z
  .object({
    ...recordedPrompt,
    mode: z.literal("live-interviewer"),
  })
  .strict();

/** The interviewer supplied a dedicated audio recording for this question. */
export const RecordedInterviewerPromptSegmentSchema = z
  .object({
    ...recordedPrompt,
    mode: z.literal("recorded-interviewer"),
  })
  .strict();

export const QuestionPromptSegmentSchema = z.discriminatedUnion("mode", [
  TextOnlyPromptSegmentSchema,
  LiveInterviewerPromptSegmentSchema,
  RecordedInterviewerPromptSegmentSchema,
]);

export type TextOnlyPromptSegment = z.infer<typeof TextOnlyPromptSegmentSchema>;
export type LiveInterviewerPromptSegment = z.infer<typeof LiveInterviewerPromptSegmentSchema>;
export type RecordedInterviewerPromptSegment = z.infer<
  typeof RecordedInterviewerPromptSegmentSchema
>;
export type QuestionPromptSegment = z.infer<typeof QuestionPromptSegmentSchema>;
export type RecordedQuestionPromptSegment =
  | LiveInterviewerPromptSegment
  | RecordedInterviewerPromptSegment;

export const isRecordedPrompt = (
  prompt: QuestionPromptSegment,
): prompt is RecordedQuestionPromptSegment => prompt.mode !== "text-only";
