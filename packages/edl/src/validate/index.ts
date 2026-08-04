import { EdlSchema, type EDL } from "../schema/edl.js";
import type { ValidationContext } from "./context.js";
import { checkConformance } from "./conformance.js";
import { checkCrossTrack } from "./crossTrack.js";
import { checkGeneral } from "./general.js";
import { IssueCollector, type ValidationResult } from "./issues.js";
import { checkMusic } from "./music.js";
import { checkPromptTimeline } from "./promptTimeline.js";
import { checkSpeechTimeline } from "./speechTimeline.js";
import { checkVisualTimeline } from "./visualTimeline.js";

/**
 * The single gate between an EDL and a renderer. Written before the renderer
 * deliberately: everything downstream — preview, compose, render — is allowed
 * to assume a validated EDL and skip defensive checks.
 *
 * Shape errors short-circuit. There is no useful contiguity report to give
 * about a segment whose durationMs is a string.
 */
export const validateEdl = (
  input: unknown,
  ctx: ValidationContext,
): ValidationResult => {
  const c = new IssueCollector();

  const parsed = EdlSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      c.error(
        "SCHEMA_INVALID",
        issue.path.length > 0 ? issue.path.join(".") : "(root)",
        issue.message,
      );
    }
    return { ok: false, errors: c.errors, warnings: c.warnings };
  }

  const edl: EDL = parsed.data;

  checkGeneral(edl, ctx, c);
  checkVisualTimeline(edl, ctx, c);
  checkPromptTimeline(edl, ctx, c);
  checkSpeechTimeline(edl, ctx, c);
  checkCrossTrack(edl, c);
  checkMusic(edl, ctx, c);
  checkConformance(edl, ctx, c);

  return c.hasErrors
    ? { ok: false, errors: c.errors, warnings: c.warnings }
    : { ok: true, edl, warnings: c.warnings };
};

/** Throwing wrapper for scripts and tests that treat invalidity as fatal. */
export const assertValidEdl = (input: unknown, ctx: ValidationContext): EDL => {
  const result = validateEdl(input, ctx);
  if (!result.ok) {
    const lines = result.errors.map((e) => `  ${e.code} at ${e.path}: ${e.message}`);
    throw new Error(`EDL failed validation (${result.errors.length} errors):\n${lines.join("\n")}`);
  }
  return result.edl;
};
