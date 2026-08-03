import { z } from "zod";
import { Id, MsInt, MsPositive } from "./primitives.js";

/**
 * One spoken word.
 *
 * Timestamps are relative to the parent SpeechSegment and start at zero —
 * never source-file time, never absolute timeline time. The EDL carries the
 * exact timings the renderer needs, so the renderer never fetches or
 * interprets a transcript.
 */
export const WordCaptionSchema = z
  .object({
    text: z.string().min(1).max(64),
    startMs: MsInt,
    endMs: MsPositive,
  })
  .strict()
  .refine((w) => w.startMs < w.endMs, {
    message: "caption startMs must be < endMs",
    path: ["endMs"],
  });

/**
 * What the selection model is permitted to choose: a word range and a tone.
 * It cannot choose fonts, colours, placement or animation — those resolve from
 * template styling at render time.
 */
export const EmphasisSelectionSchema = z
  .object({
    startWord: z.number().int().nonnegative(),
    endWord: z.number().int().nonnegative(),
    tone: z.enum(["funny", "meaningful", "surprising"]),
  })
  .strict()
  .refine((e) => e.startWord <= e.endWord, {
    message: "emphasis startWord must be <= endWord",
    path: ["endWord"],
  });

export const SpeechSegmentSchema = z
  .object({
    id: Id,
    questionId: Id,
    assetId: Id,
    startMs: MsInt,
    durationMs: MsPositive,
    sourceInMs: MsInt,
    sourceOutMs: MsPositive,
    captions: z.array(WordCaptionSchema).min(1),
    emphasis: EmphasisSelectionSchema.optional(),
  })
  .strict();

export type WordCaption = z.infer<typeof WordCaptionSchema>;
export type EmphasisSelection = z.infer<typeof EmphasisSelectionSchema>;
export type SpeechSegment = z.infer<typeof SpeechSegmentSchema>;
