import type { EDL } from "../schema/edl.js";
import { indexManifest } from "../schema/manifest.js";
import type { ValidationContext } from "./context.js";
import type { IssueCollector } from "./issues.js";

/**
 * Unlike the visual track, the speech track is allowed to have gaps — silence
 * between answers is the point — but it may never overlap itself. Two people
 * talking at once is not something this form does, and if it ever is, it will
 * be an explicit feature rather than an accident of two segments colliding.
 */
export const checkSpeechTimeline = (
  edl: EDL,
  ctx: ValidationContext,
  c: IssueCollector,
): void => {
  const assets = indexManifest(ctx.manifest);
  const segments = edl.speechSegments;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s === undefined) continue;
    const path = `speechSegments[${i}]`;
    const end = s.startMs + s.durationMs;

    if (i > 0) {
      const prev = segments[i - 1];
      if (prev !== undefined) {
        if (s.startMs < prev.startMs) {
          c.error(
            "SPEECH_NOT_SORTED",
            `${path}.startMs`,
            `startMs ${s.startMs} precedes previous segment's ${prev.startMs}`,
          );
        } else if (s.startMs < prev.startMs + prev.durationMs) {
          c.error(
            "SPEECH_OVERLAP",
            `${path}.startMs`,
            `starts at ${s.startMs}ms while "${prev.id}" runs to ` +
              `${prev.startMs + prev.durationMs}ms`,
          );
        }
      }
    }

    if (end > edl.totalDurationMs) {
      c.error(
        "SPEECH_OUTSIDE_TIMELINE",
        `${path}.durationMs`,
        `runs to ${end}ms, past totalDurationMs ${edl.totalDurationMs}ms`,
      );
    }

    const span = s.sourceOutMs - s.sourceInMs;
    if (span !== s.durationMs) {
      c.error(
        "SOURCE_SPAN_MISMATCH",
        `${path}.sourceOutMs`,
        `source span ${span}ms does not equal durationMs ${s.durationMs}ms`,
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

    let previousEnd = -1;
    s.captions.forEach((w, k) => {
      const wPath = `${path}.captions[${k}]`;
      if (w.endMs > s.durationMs) {
        c.error(
          "CAPTION_OUT_OF_BOUNDS",
          `${wPath}.endMs`,
          `word "${w.text}" ends at ${w.endMs}ms, past the segment's ${s.durationMs}ms; ` +
            "caption times are relative to the segment and start at zero",
        );
      }
      if (w.startMs < previousEnd) {
        c.error(
          "CAPTION_NOT_SORTED",
          `${wPath}.startMs`,
          `word "${w.text}" starts at ${w.startMs}ms, overlapping the previous word ` +
            `which ends at ${previousEnd}ms`,
        );
      }
      previousEnd = w.endMs;
    });

    if (s.emphasis !== undefined) {
      const n = s.captions.length;
      if (s.emphasis.endWord >= n) {
        c.error(
          "EMPHASIS_OUT_OF_RANGE",
          `${path}.emphasis.endWord`,
          `word index ${s.emphasis.endWord} is past the last caption (${n - 1})`,
        );
      }
    }
  }
};
