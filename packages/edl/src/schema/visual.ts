import { z } from "zod";
import { Id, MsInt, MsPositive, TextKey, Unit } from "./primitives.js";
import { TransitionSchema } from "./transition.js";

/**
 * Fields common to every visual segment.
 *
 * `overlayTextKey` renders a template text key over the segment using the
 * reduced `overlay` treatment. It exists because the opening line of this form
 * sits over a candid moving image, and no other kind can carry text on picture.
 * It is a KEY, never a literal — the template owns all copy. A segment may not
 * carry both `overlayTextKey` and its own `textKey`; the validator rejects that
 * (OVERLAY_TEXT_COLLISION) since a discriminated union member cannot refine
 * itself and stay a ZodObject.
 */
const baseVisual = {
  id: Id,
  startMs: MsInt,
  durationMs: MsPositive,
  transitionIn: TransitionSchema,
  overlayTextKey: TextKey.optional(),
};

export const TitleSegmentSchema = z
  .object({
    ...baseVisual,
    kind: z.literal("title"),
    textKey: TextKey,
    reveal: z.enum(["sequential", "fade"]),
  })
  .strict();

export const BlackSegmentSchema = z
  .object({
    ...baseVisual,
    kind: z.literal("black"),
    textKey: TextKey.optional(),
    /**
     * Which type treatment the text gets. Defaults to the title's.
     *
     * A question card is a card on black like the end title, but the end title
     * is three words at 8.5vh and a question is a whole sentence — "What would
     * you like to say to whoever watches this?" set at title size is a wall.
     * `question` is the treatment the template already tuned for question
     * wording, which is the same reason the format's `titleMaxChars` does not
     * apply to it.
     */
    textStyle: z.enum(["title", "question"]).optional(),
  })
  .strict();

/**
 * A talking head.
 *
 * There is deliberately no audio, volume, gain or muted field. Every frame of
 * interview audio comes from the speech track; because the object is strict,
 * an EDL that tries to unmute a picture segment is not a bug that renders
 * wrong, it is a parse error. See docs/proposal §7.
 *
 * JSON `1.0` parses to the number 1, so z.literal(1) is the correct spelling
 * of the 1.0 punch-in scale.
 */
export const InterviewSegmentSchema = z
  .object({
    ...baseVisual,
    kind: z.literal("interview"),
    assetId: Id,
    sourceInMs: MsInt,
    sourceOutMs: MsPositive,
    scale: z.union([z.literal(1), z.literal(1.06), z.literal(1.1)]),
  })
  .strict();

export const PhotoSegmentSchema = z
  .object({
    ...baseVisual,
    kind: z.literal("photo"),
    assetId: Id,
    slotId: Id,
    focalPoint: z.object({ x: Unit, y: Unit }).strict(),
    motion: z.enum(["in", "out", "panLeft", "panRight", "still"]),
    intensity: Unit,
    /**
     * The photo's own reveal animation. Ignored when transitionIn.type is not
     * "cut" — you cannot inset-expand out of a dissolve (proposal §8.8).
     */
    entry: z.enum(["cut", "insetExpand"]),
  })
  .strict();

/** Supplementary video. Source audio is not muted by default — it is absent. */
export const BrollSegmentSchema = z
  .object({
    ...baseVisual,
    kind: z.literal("broll"),
    assetId: Id,
    slotId: Id,
    sourceInMs: MsInt,
    sourceOutMs: MsPositive,
  })
  .strict();

export const VisualSegmentSchema = z.discriminatedUnion("kind", [
  TitleSegmentSchema,
  BlackSegmentSchema,
  InterviewSegmentSchema,
  PhotoSegmentSchema,
  BrollSegmentSchema,
]);

export type TitleSegment = z.infer<typeof TitleSegmentSchema>;
export type BlackSegment = z.infer<typeof BlackSegmentSchema>;
export type InterviewSegment = z.infer<typeof InterviewSegmentSchema>;
export type PhotoSegment = z.infer<typeof PhotoSegmentSchema>;
export type BrollSegment = z.infer<typeof BrollSegmentSchema>;
export type VisualSegment = z.infer<typeof VisualSegmentSchema>;

export type VisualKind = VisualSegment["kind"];

/** Segments that trim a time range out of a source media file. */
export type TimedVisualSegment = InterviewSegment | BrollSegment;

export const isTimedVisual = (s: VisualSegment): s is TimedVisualSegment =>
  s.kind === "interview" || s.kind === "broll";

/** Segments that occupy a named template slot. */
export const hasSlot = (s: VisualSegment): s is PhotoSegment | BrollSegment =>
  s.kind === "photo" || s.kind === "broll";

export const endOf = (s: { startMs: number; durationMs: number }): number =>
  s.startMs + s.durationMs;
