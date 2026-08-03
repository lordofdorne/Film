import { z } from "zod";

/**
 * Phase-4 answer-selection contract. Defined now so the JSON Schema handed to
 * the model is generated from this rather than hand-written, and so the shape
 * cannot drift from what the compose stage expects.
 *
 * The model returns WORD INDICES, never timestamps. Conversion to milliseconds,
 * snapping to surrounding silence, and the template's 150ms / 250ms handles are
 * all deterministic work done afterwards, where they can be tested.
 */
export const SelectionSchema = z
  .object({
    verdict: z.string().min(1).max(400),
    start_word: z.number().int().nonnegative(),
    end_word: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(1000),
    flag_review: z.boolean(),
  })
  .strict()
  .refine((s) => s.start_word <= s.end_word, {
    message: "start_word must be <= end_word",
    path: ["end_word"],
  });

export type Selection = z.infer<typeof SelectionSchema>;

/**
 * Recorded alongside every transcript and selection. Temperature 0 does not
 * guarantee determinism, so provenance is stored for every call regardless.
 */
export const AiProvenanceSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    modelVersion: z.string().min(1).optional(),
    promptVersion: z.string().min(1),
    schemaVersion: z.string().min(1),
    rawResponseKey: z.string().min(1),
  })
  .strict();

export type AiProvenance = z.infer<typeof AiProvenanceSchema>;
