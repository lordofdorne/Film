import type { EDL } from "../schema/edl.js";
import { indexManifest } from "../schema/manifest.js";
import { endOf, isTimedVisual } from "../schema/visual.js";
import type { ValidationContext } from "./context.js";
import type { IssueCollector } from "./issues.js";

/**
 * The visual timeline is contiguous-with-overlap, not gapless-and-disjoint:
 * a crossfade needs both segments on screen at once, so the invariant is
 *
 *   current.startMs === previous.startMs + previous.durationMs
 *                       - current.transitionIn.durationMs
 *
 * which collapses to plain adjacency when the transition is a cut. Any other
 * gap or overlap is an error — an undeclared gap renders as a black flash and
 * an undeclared overlap renders as whichever segment happens to be later in
 * the array, which is not a decision anyone made.
 */
export const checkVisualTimeline = (
  edl: EDL,
  ctx: ValidationContext,
  c: IssueCollector,
): void => {
  const segments = edl.visualSegments;
  const assets = indexManifest(ctx.manifest);

  const first = segments[0];
  if (first !== undefined && first.transitionIn.durationMs !== 0) {
    c.error(
      "VISUAL_FIRST_HAS_TRANSITION",
      "visualSegments[0].transitionIn",
      "the first visual segment has nothing to transition from",
    );
  }

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s === undefined) continue;
    const path = `visualSegments[${i}]`;

    if (i > 0) {
      const prev = segments[i - 1];
      if (prev !== undefined) {
        if (s.startMs <= prev.startMs) {
          c.error(
            "VISUAL_NOT_SORTED",
            `${path}.startMs`,
            `startMs ${s.startMs} does not follow previous segment's ${prev.startMs}`,
          );
        }

        const expected = prev.startMs + prev.durationMs - s.transitionIn.durationMs;
        if (s.startMs !== expected) {
          const delta = s.startMs - expected;
          c.error(
            "VISUAL_CONTIGUITY_BROKEN",
            `${path}.startMs`,
            `startMs ${s.startMs} should be ${expected} ` +
              `(previous ends ${endOf(prev)} minus ${s.transitionIn.durationMs}ms transition); ` +
              `${delta > 0 ? `${delta}ms gap` : `${-delta}ms undeclared overlap`}`,
          );
        }

        const longest = Math.min(prev.durationMs, s.durationMs);
        if (s.transitionIn.durationMs > longest) {
          c.error(
            "VISUAL_TRANSITION_TOO_LONG",
            `${path}.transitionIn.durationMs`,
            `${s.transitionIn.durationMs}ms exceeds the shorter adjacent segment (${longest}ms)`,
          );
        }
      }
    }

    if (isTimedVisual(s)) {
      const span = s.sourceOutMs - s.sourceInMs;
      if (span !== s.durationMs) {
        c.error(
          "SOURCE_SPAN_MISMATCH",
          `${path}.sourceOutMs`,
          `source span ${span}ms does not equal durationMs ${s.durationMs}ms; ` +
            "phase 1 has no speed ramping",
        );
      }
      const asset = assets.get(s.assetId);
      if (asset?.durationMs !== undefined && s.sourceOutMs > asset.durationMs) {
        c.error(
          "SOURCE_RANGE_OUTSIDE_ASSET",
          `${path}.sourceOutMs`,
          `reads to ${s.sourceOutMs}ms of asset "${s.assetId}", which is ${asset.durationMs}ms long`,
        );
      }
    }

    if (s.kind === "interview" && !ctx.conformance.interviewScales.includes(s.scale)) {
      c.error(
        "INTERVIEW_SCALE_UNSUPPORTED",
        `${path}.scale`,
        `punch-in ${s.scale} is not one of the template's scales ` +
          `(${ctx.conformance.interviewScales.join(", ")})`,
      );
    }
  }

  const last = segments[segments.length - 1];
  if (last !== undefined && endOf(last) !== edl.totalDurationMs) {
    c.error(
      "VISUAL_DOES_NOT_END_AT_TOTAL",
      `visualSegments[${segments.length - 1}]`,
      `visual track ends at ${endOf(last)}ms but totalDurationMs is ${edl.totalDurationMs}ms`,
    );
  }
};
