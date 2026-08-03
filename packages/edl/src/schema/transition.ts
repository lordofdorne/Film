import { z } from "zod";
import { MsInt } from "./primitives.js";

/**
 * Transition semantics — one definition, used by both the validator and the
 * renderer:
 *
 *   cut        instantaneous. durationMs is always 0.
 *   crossfade  both segments are drawn during the overlap; the incoming one
 *              ramps 0 -> 1 opacity over the outgoing one.
 *   fade       only the INCOMING segment is drawn during the overlap, ramping
 *              up from black. The outgoing segment's tail is not composited.
 *
 * The `fade` definition is the one that needed picking (proposal §8.8). It
 * makes "dip to black" expressible without a second transition type, at the
 * cost of discarding the outgoing tail — which is why the validator still
 * requires that tail to exist in the source range.
 */
export const TransitionSchema = z
  .object({
    type: z.enum(["cut", "crossfade", "fade"]),
    durationMs: MsInt,
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.type === "cut" && t.durationMs !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMs"],
        message: "cut transitions must have durationMs === 0",
      });
    }
    if (t.type !== "cut" && t.durationMs <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMs"],
        message: `${t.type} transitions require durationMs > 0`,
      });
    }
  });

export type Transition = z.infer<typeof TransitionSchema>;

export const CUT: Transition = { type: "cut", durationMs: 0 };
