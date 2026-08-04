import { z } from "zod";
import { Id, MsPositive } from "./primitives.js";

/**
 * What the validator is told about the media an EDL references. Built from the
 * `assets` table in production and from a fixture description offline; either
 * way the EDL itself never carries dimensions, durations or URLs.
 */
const visualAssetFields = {
  id: Id,
  durationMs: MsPositive.optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
};

export const InterviewAssetEntrySchema = z
  .object({
    ...visualAssetFields,
    kind: z.literal("interview"),
    questionId: Id,
    durationMs: MsPositive,
  })
  .strict();

export const PhotoAssetEntrySchema = z
  .object({
    ...visualAssetFields,
    kind: z.literal("photo"),
    slotId: Id,
  })
  .strict();

export const VideoAssetEntrySchema = z
  .object({
    ...visualAssetFields,
    kind: z.literal("video"),
    slotId: Id,
    durationMs: MsPositive,
  })
  .strict();

/** A normalised, audio-only interviewer recording bound to one question. */
export const AudioAssetEntrySchema = z
  .object({
    id: Id,
    kind: z.literal("audio"),
    questionId: Id,
    durationMs: MsPositive,
  })
  .strict();

export const AssetEntrySchema = z.discriminatedUnion("kind", [
  InterviewAssetEntrySchema,
  PhotoAssetEntrySchema,
  VideoAssetEntrySchema,
  AudioAssetEntrySchema,
]);

export const AssetManifestSchema = z
  .object({ assets: z.array(AssetEntrySchema).min(1) })
  .strict();

export type AssetEntry = z.infer<typeof AssetEntrySchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export const indexManifest = (m: AssetManifest): ReadonlyMap<string, AssetEntry> =>
  new Map(m.assets.map((a) => [a.id, a]));
