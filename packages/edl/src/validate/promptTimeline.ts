import type { EDL } from "../schema/edl.js";
import { indexManifest } from "../schema/manifest.js";
import { isRecordedPrompt } from "../schema/prompt.js";
import type { ValidationContext } from "./context.js";
import type { IssueCollector } from "./issues.js";

const overlaps = (a1: number, a2: number, b1: number, b2: number): boolean =>
  Math.max(a1, b1) < Math.min(a2, b2);

/**
 * Question prompts are a third timeline. They may have silence between them,
 * but never overlap another prompt or an answer: the question must finish
 * before the storyteller begins, regardless of whether the prompt has audio.
 */
export const checkPromptTimeline = (
  edl: EDL,
  ctx: ValidationContext,
  c: IssueCollector,
): void => {
  const assets = indexManifest(ctx.manifest);

  edl.promptSegments.forEach((prompt, i) => {
    const path = `promptSegments[${i}]`;
    const end = prompt.startMs + prompt.durationMs;
    const previous = edl.promptSegments[i - 1];

    if (previous !== undefined) {
      if (prompt.startMs < previous.startMs) {
        c.error(
          "PROMPT_NOT_SORTED",
          `${path}.startMs`,
          `startMs ${prompt.startMs} precedes previous prompt's ${previous.startMs}`,
        );
      } else if (prompt.startMs < previous.startMs + previous.durationMs) {
        c.error(
          "PROMPT_OVERLAP",
          `${path}.startMs`,
          `starts at ${prompt.startMs}ms while "${previous.id}" runs to ` +
            `${previous.startMs + previous.durationMs}ms`,
        );
      }
    }

    if (end > edl.totalDurationMs) {
      c.error(
        "PROMPT_OUTSIDE_TIMELINE",
        `${path}.durationMs`,
        `runs to ${end}ms, past totalDurationMs ${edl.totalDurationMs}ms`,
      );
    }

    if (isRecordedPrompt(prompt)) {
      const span = prompt.sourceOutMs - prompt.sourceInMs;
      if (span !== prompt.durationMs) {
        c.error(
          "SOURCE_SPAN_MISMATCH",
          `${path}.sourceOutMs`,
          `source span ${span}ms does not equal durationMs ${prompt.durationMs}ms`,
        );
      }
      const asset = assets.get(prompt.assetId);
      if (asset?.durationMs !== undefined && prompt.sourceOutMs > asset.durationMs) {
        c.error(
          "SOURCE_RANGE_OUTSIDE_ASSET",
          `${path}.sourceOutMs`,
          `reads to ${prompt.sourceOutMs}ms of asset "${prompt.assetId}", ` +
            `which is ${asset.durationMs}ms long`,
        );
      }
    }

    let previousWordEnd = -1;
    prompt.captions.forEach((word, wordIndex) => {
      const wordPath = `${path}.captions[${wordIndex}]`;
      if (word.endMs > prompt.durationMs) {
        c.error(
          "CAPTION_OUT_OF_BOUNDS",
          `${wordPath}.endMs`,
          `word "${word.text}" ends at ${word.endMs}ms, past the prompt's ` +
            `${prompt.durationMs}ms`,
        );
      }
      if (word.startMs < previousWordEnd) {
        c.error(
          "CAPTION_NOT_SORTED",
          `${wordPath}.startMs`,
          `word "${word.text}" starts at ${word.startMs}ms, overlapping the previous word`,
        );
      }
      previousWordEnd = word.endMs;
    });

    for (let speechIndex = 0; speechIndex < edl.speechSegments.length; speechIndex++) {
      const speech = edl.speechSegments[speechIndex];
      if (speech === undefined) continue;
      if (
        overlaps(
          prompt.startMs,
          end,
          speech.startMs,
          speech.startMs + speech.durationMs,
        )
      ) {
        c.error(
          "PROMPT_SPEECH_OVERLAP",
          `${path}.startMs`,
          `prompt "${prompt.id}" overlaps answer "${speech.id}"; ` +
            "a question must finish before its answer begins",
        );
      }
    }
  });
};
