import { getFormat } from "@film/formats";
import { resolveTrack } from "@film/music";
import { LIFE_ADVICE_V1 } from "./life-advice/v1.js";
import type { Template } from "./types.js";

/**
 * Every project stores both template_id and template_version. A version
 * already used by a project is never mutated; changes ship as a new version,
 * which is why this is a map of maps rather than a map of latest.
 */
export const TEMPLATE_REGISTRY = {
  "life-advice": { 1: LIFE_ADVICE_V1 },
} as const satisfies Record<string, Record<number, Template>>;

export type TemplateId = keyof typeof TEMPLATE_REGISTRY;

export const getTemplate = (id: string, version: number): Template => {
  const versions = (TEMPLATE_REGISTRY as Record<string, Record<number, Template> | undefined>)[id];
  const template = versions?.[version];
  if (template === undefined) {
    const known = Object.entries(TEMPLATE_REGISTRY)
      .flatMap(([tid, vs]) => Object.keys(vs).map((v) => `${tid}@${v}`))
      .join(", ");
    throw new Error(`unknown template "${id}@${version}"; registered: ${known}`);
  }
  return template;
};

export type TemplateIssue = {
  readonly severity: "error" | "warning";
  readonly message: string;
};

/**
 * Checks a template against the registries it depends on. Separate from
 * validateEdl: this is a launch-readiness question about the product, not a
 * correctness question about one film.
 */
export const validateTemplate = (t: Template): TemplateIssue[] => {
  const issues: TemplateIssue[] = [];

  for (const id of t.formatIds) {
    try {
      getFormat(id);
    } catch {
      issues.push({ severity: "error", message: `format "${id}" is not registered` });
    }
  }
  if (!t.formatIds.includes(t.defaultFormatId)) {
    issues.push({
      severity: "error",
      message: `defaultFormatId "${t.defaultFormatId}" is not among formatIds`,
    });
  }

  for (const id of t.musicOptions) {
    const track = resolveTrack(id);
    if (track === undefined) {
      issues.push({
        severity: "warning",
        message: `music option "${id}" is not commissioned yet`,
      });
    } else if (track.usage !== "licensed") {
      issues.push({
        severity: "error",
        message: `music option "${id}" has usage "${track.usage}" and cannot be offered`,
      });
    }
  }
  if (!t.musicOptions.includes(t.defaultMusicTrackId)) {
    issues.push({
      severity: "error",
      message: `defaultMusicTrackId "${t.defaultMusicTrackId}" is not among musicOptions`,
    });
  }

  if (!t.questionPrompt.supportedModes.includes(t.questionPrompt.defaultMode)) {
    issues.push({
      severity: "error",
      message:
        `default question-prompt mode "${t.questionPrompt.defaultMode}" is not among ` +
        "supportedModes",
    });
  }
  if (new Set(t.questionPrompt.supportedModes).size !== t.questionPrompt.supportedModes.length) {
    issues.push({ severity: "error", message: "question-prompt modes are not unique" });
  }
  if (t.questionPrompt.answerGapMs < 0) {
    issues.push({ severity: "error", message: "question-prompt answerGapMs cannot be negative" });
  }

  // Every beat must be sourced, and every source must exist.
  const questionIds = new Set(t.questions.map((q) => q.id));
  const slotIds = new Set(
    [...t.photoSlots, ...t.videoSlots, ...t.optionalSlots].map((s) => s.id),
  );
  for (const beat of t.structure) {
    const source = t.beatSources[beat];
    if (source === undefined) {
      issues.push({ severity: "error", message: `structural beat "${beat}" has no source` });
      continue;
    }
    switch (source.kind) {
      case "title":
        if (t.text.keys[source.textKey] === undefined) {
          issues.push({
            severity: "error",
            message: `beat "${beat}" wants text key "${source.textKey}", which is not defined`,
          });
        }
        break;
      case "slot":
        for (const id of [source.slotId, source.fallbackSlotId]) {
          if (id !== undefined && !slotIds.has(id)) {
            issues.push({
              severity: "error",
              message: `beat "${beat}" wants slot "${id}", which is not defined`,
            });
          }
        }
        break;
      case "question":
        if (!questionIds.has(source.questionId)) {
          issues.push({
            severity: "error",
            message: `beat "${beat}" wants question "${source.questionId}", which is not asked`,
          });
        }
        break;
      case "questions":
        for (const id of source.questionIds) {
          if (!questionIds.has(id)) {
            issues.push({
              severity: "error",
              message: `beat "${beat}" wants question "${id}", which is not asked`,
            });
          }
        }
        break;
    }
  }

  // Required slots named in conformance must actually be declared as required.
  const required = new Set(
    [...t.photoSlots, ...t.videoSlots].filter((s) => s.required).map((s) => s.id),
  );
  for (const id of [
    ...t.conformance.requiredPhotoSlotIds,
    ...t.conformance.requiredVideoSlotIds,
  ]) {
    if (!required.has(id)) {
      issues.push({
        severity: "error",
        message: `conformance requires slot "${id}" but the slot is not marked required`,
      });
    }
  }

  const orders = t.questions.map((q) => q.order);
  if (new Set(orders).size !== orders.length) {
    issues.push({ severity: "error", message: "question orders are not unique" });
  }

  return issues;
};
