import type { EDL } from "../schema/edl.js";
import { hasSlot } from "../schema/visual.js";
import type { ValidationContext } from "./context.js";
import type { IssueCollector } from "./issues.js";

/**
 * Rules that come from the template's editing grammar rather than from the
 * shape of an EDL. Everything here reads out of ctx.conformance, so a second
 * template gets these checks for free without touching this file.
 */
export const checkConformance = (
  edl: EDL,
  ctx: ValidationContext,
  c: IssueCollector,
): void => {
  const t = ctx.conformance;

  const emphasised = edl.speechSegments.filter((s) => s.emphasis !== undefined);
  if (emphasised.length > t.maxEmphasisPerFilm) {
    c.error(
      "TOO_MANY_EMPHASIS",
      "speechSegments",
      `${emphasised.length} segments carry emphasis; the template allows ` +
        `${t.maxEmphasisPerFilm} (${emphasised.map((s) => s.id).join(", ")})`,
    );
  }

  // Photos are punctuation. A third consecutive still stops reading as a cut
  // between images and starts reading as a slideshow.
  let run = 0;
  edl.visualSegments.forEach((s, i) => {
    if (s.kind === "photo") {
      run += 1;
      if (run > t.maxConsecutivePhotos) {
        c.error(
          "TOO_MANY_CONSECUTIVE_PHOTOS",
          `visualSegments[${i}]`,
          `${run} photo segments in a row; the template allows ` +
            `${t.maxConsecutivePhotos} before returning to motion footage`,
        );
      }
    } else if (s.kind === "interview" || s.kind === "broll") {
      run = 0;
    }
    // title and black neither extend nor break a photo run: they are a beat,
    // not a return to the subject.
  });

  const filled = new Set(
    edl.visualSegments.filter(hasSlot).map((s) => s.slotId),
  );
  for (const slotId of [...t.requiredPhotoSlotIds, ...t.requiredVideoSlotIds]) {
    if (!filled.has(slotId)) {
      c.error(
        "REQUIRED_SLOT_MISSING",
        "visualSegments",
        `required slot "${slotId}" never appears in the film`,
      );
    }
  }

  const known = new Set(t.questionIds);
  edl.speechSegments.forEach((s, i) => {
    if (!known.has(s.questionId)) {
      c.error(
        "UNKNOWN_QUESTION_ID",
        `speechSegments[${i}].questionId`,
        `"${s.questionId}" is not a question in ${t.templateId}@${t.templateVersion}`,
      );
    }
  });
  edl.promptSegments.forEach((prompt, i) => {
    if (!known.has(prompt.questionId)) {
      c.error(
        "UNKNOWN_QUESTION_ID",
        `promptSegments[${i}].questionId`,
        `"${prompt.questionId}" is not a question in ${t.templateId}@${t.templateVersion}`,
      );
    }

    const answer = edl.speechSegments.find(
      (speech) =>
        speech.questionId === prompt.questionId &&
        speech.startMs >= prompt.startMs + prompt.durationMs,
    );
    if (answer === undefined) {
      c.error(
        "PROMPT_ANSWER_MISSING",
        `promptSegments[${i}].questionId`,
        `question prompt "${prompt.id}" has no later answer for "${prompt.questionId}"`,
      );
      return;
    }

    const gap = answer.startMs - (prompt.startMs + prompt.durationMs);
    if (gap < t.minPromptAnswerGapMs) {
      c.error(
        "PROMPT_ANSWER_GAP_TOO_SHORT",
        `promptSegments[${i}].durationMs`,
        `question ends ${gap}ms before answer "${answer.id}"; ` +
          `the template requires at least ${t.minPromptAnswerGapMs}ms`,
      );
    }
    if (prompt.mode === "live-interviewer" && prompt.assetId !== answer.assetId) {
      c.error(
        "LIVE_PROMPT_ANSWER_ASSET_MISMATCH",
        `promptSegments[${i}].assetId`,
        `live prompt reads "${prompt.assetId}" but its answer reads "${answer.assetId}"; ` +
          "a live question and answer must come from the same take",
      );
    }
  });

  // A warning: a film slightly outside the target is a note to the editor,
  // not a reason to refuse to render it.
  const { min, max } = t.targetDurationMs;
  if (edl.totalDurationMs < min || edl.totalDurationMs > max) {
    c.warn(
      "DURATION_OUTSIDE_TARGET",
      "totalDurationMs",
      `${edl.totalDurationMs}ms is outside the template's target range ${min}–${max}ms`,
    );
  }
};
