import { z } from "zod";
import { Id, MsPositive } from "./primitives.js";

/**
 * What the validator is told about the media an EDL references. Built from the
 * `assets` table in production and from a fixture description offline; either
 * way the EDL itself never carries dimensions, durations or URLs.
 */
export const AssetEntrySchema = z
  .object({
    id: Id,
    kind: z.enum(["interview", "photo", "video"]),
    /** Interview clips are bound to the question they answer. */
    questionId: Id.optional(),
    /** Photos and supplementary videos are bound to a named template slot. */
    slotId: Id.optional(),
    /** Required for interview and video; meaningless for a still. */
    durationMs: MsPositive.optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.kind !== "photo" && a.durationMs === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMs"],
        message: `${a.kind} assets require durationMs`,
      });
    }
    if (a.kind === "interview" && a.questionId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questionId"],
        message: "interview assets require questionId",
      });
    }
    if (a.kind !== "interview" && a.slotId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slotId"],
        message: `${a.kind} assets require slotId`,
      });
    }
  });

export const AssetManifestSchema = z
  .object({ assets: z.array(AssetEntrySchema).min(1) })
  .strict();

export type AssetEntry = z.infer<typeof AssetEntrySchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export const indexManifest = (m: AssetManifest): ReadonlyMap<string, AssetEntry> =>
  new Map(m.assets.map((a) => [a.id, a]));
