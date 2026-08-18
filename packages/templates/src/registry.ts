import { getFormat } from "@film/formats";
import { resolveTrack } from "@film/music";
import { REQUIRED_SUBJECT_FIELDS } from "./interpolate.js";
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

  /**
   * The walk-through must ask for everything the film needs, exactly once.
   *
   * The capture order is authored separately from the film's structure so the
   * two can be changed independently — which means they can also fall out of
   * step. A question nobody is asked produces a project that ingests happily
   * and then cannot be composed, and the customer is long gone by then.
   */
  const fieldIds = new Set(t.details.map((f) => f.id));
  const asked = new Map<string, number>();
  for (const chapter of t.capture.chapters) {
    for (const step of chapter.steps) {
      const id =
        step.kind === "question" ? step.questionId : step.kind === "slot" ? step.slotId : step.fieldId;
      const known =
        step.kind === "question"
          ? questionIds.has(id)
          : step.kind === "slot"
            ? slotIds.has(id)
            : fieldIds.has(id);
      if (!known) {
        issues.push({
          severity: "error",
          message: `capture chapter "${chapter.id}" asks for ${step.kind} "${id}", which is not defined`,
        });
        continue;
      }
      asked.set(id, (asked.get(id) ?? 0) + 1);
    }
  }
  for (const [id, count] of asked) {
    if (count > 1) {
      issues.push({
        severity: "error",
        message: `capture asks for "${id}" ${String(count)} times`,
      });
    }
  }
  for (const question of t.questions) {
    if (question.required && !asked.has(question.id)) {
      issues.push({
        severity: "error",
        message: `question "${question.id}" is required but capture never asks it`,
      });
    }
  }
  for (const slot of [...t.photoSlots, ...t.videoSlots, ...t.optionalSlots]) {
    if (slot.required && !asked.has(slot.id)) {
      issues.push({
        severity: "error",
        message: `slot "${slot.id}" is required but capture never asks for it`,
      });
    }
  }
  for (const field of t.details) {
    if (field.required && !asked.has(field.id)) {
      issues.push({
        severity: "error",
        message: `detail "${field.id}" is required but capture never asks for it`,
      });
    }
  }

  /**
   * The walk-through must be able to fill the subject in.
   *
   * Details are steps now, so a project's subject starts empty and ends with
   * whatever the walk-through collected. A subject field the film requires
   * that no required detail step ever asks for — directly, or as a prefill of
   * another answer — is a film that cannot be worded, which is worse than one
   * that cannot be started.
   */
  const requiredDetails = t.details.filter((f) => f.required && asked.has(f.id));
  for (const name of REQUIRED_SUBJECT_FIELDS) {
    const covered = requiredDetails.some(
      (f) =>
        (f.target === "subject" && f.id === name) || (f.prefills?.includes(name) ?? false),
    );
    if (!covered) {
      issues.push({
        severity: "error",
        message: `subject field "${name}" is required to word the film but no required detail step collects it`,
      });
    }
  }

  return issues;
};
