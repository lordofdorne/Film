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

  /**
   * A warning, and only about things the EDIT can be blamed for.
   *
   * A film is as long as somebody talked for. The target range describes a
   * film built from the material this template expects — so a film that runs
   * short because the answers were short is not outside anything, it is a
   * shorter film, and saying otherwise would have this rule firing on most
   * real customers while telling nobody anything actionable.
   *
   * Too LONG is always worth saying: the material was there and the edit did
   * not shape it. Too SHORT is worth saying only when there was enough speech
   * to have reached the target, which means the edit lost it — that is a
   * defect, and the one this rule can genuinely detect.
   */
  const { min, max } = t.targetDurationMs;
  const speechMs = edl.speechSegments.reduce((total, s) => total + s.durationMs, 0);

  if (edl.totalDurationMs > max) {
    c.warn(
      "DURATION_OUTSIDE_TARGET",
      "totalDurationMs",
      `${edl.totalDurationMs}ms is longer than the template's target of ${min}–${max}ms`,
    );
  } else if (edl.totalDurationMs < min && speechMs >= min * SPEECH_ENOUGH_FOR_TARGET) {
    c.warn(
      "DURATION_OUTSIDE_TARGET",
      "totalDurationMs",
      `${edl.totalDurationMs}ms is short of the template's target of ${min}–${max}ms, ` +
        `and there were ${speechMs}ms of answers to build from`,
    );
  }
};

/**
 * The share of the target that has to be speech before a short film counts as
 * the edit's fault rather than the material's.
 *
 * Structure — opening, title, photographs, end card — is the rest. Below this
 * there was simply not enough said to make a film of that length, however it
 * were cut.
 */
const SPEECH_ENOUGH_FOR_TARGET = 0.7;
