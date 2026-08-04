import type { EDL } from "../schema/edl.js";
import { indexManifest, type AssetEntry } from "../schema/manifest.js";
import { isFrameAligned } from "../schema/primitives.js";
import { isRecordedPrompt } from "../schema/prompt.js";
import { hasSlot } from "../schema/visual.js";
import type { ValidationContext } from "./context.js";
import type { IssueCollector } from "./issues.js";

/** Segment kind -> the asset kind it must reference. */
const EXPECTED_ASSET_KIND = {
  interview: "interview",
  broll: "video",
  photo: "photo",
} as const;

export const checkGeneral = (
  edl: EDL,
  ctx: ValidationContext,
  c: IssueCollector,
): void => {
  const assets = indexManifest(ctx.manifest);

  if (edl.fps !== ctx.format.fps) {
    c.error(
      "FPS_FORMAT_MISMATCH",
      "fps",
      `EDL fps ${edl.fps} does not match format ${ctx.format.id} (${ctx.format.fps})`,
    );
  }

  if (
    edl.templateId !== ctx.conformance.templateId ||
    edl.templateVersion !== ctx.conformance.templateVersion
  ) {
    c.error(
      "TEMPLATE_MISMATCH",
      "templateId",
      `EDL declares ${edl.templateId}@${edl.templateVersion} but was validated ` +
        `against ${ctx.conformance.templateId}@${ctx.conformance.templateVersion}`,
    );
  }

  // Ids are unique across every track. Segment ids appear in render logs and
  // golden-frame names, where a collision between a visual and a speech
  // segment would be quietly confusing.
  const seen = new Set<string>();
  const noteId = (id: string, path: string): void => {
    if (seen.has(id)) {
      c.error("DUPLICATE_SEGMENT_ID", path, `segment id "${id}" is used more than once`);
    }
    seen.add(id);
  };

  const minDurationMs = Math.ceil((2 * 1000) / edl.fps);

  edl.visualSegments.forEach((s, i) => {
    const path = `visualSegments[${i}]`;
    noteId(s.id, `${path}.id`);
    checkGridAndLength(s, path, edl.fps, minDurationMs, c);

    if ((s.kind === "title" || s.kind === "black") && s.textKey !== undefined) {
      if (s.overlayTextKey !== undefined) {
        c.error(
          "OVERLAY_TEXT_COLLISION",
          `${path}.overlayTextKey`,
          `${s.kind} segment carries both textKey and overlayTextKey; ` +
            "a segment renders one text treatment, not two",
        );
      }
    }

    if (!("assetId" in s)) return;
    const asset = assets.get(s.assetId);
    if (asset === undefined) {
      c.error("UNKNOWN_ASSET", `${path}.assetId`, `asset "${s.assetId}" is not in the manifest`);
      return;
    }
    const expected = EXPECTED_ASSET_KIND[s.kind as keyof typeof EXPECTED_ASSET_KIND];
    if (asset.kind !== expected) {
      c.error(
        "ASSET_KIND_MISMATCH",
        `${path}.assetId`,
        `${s.kind} segment references a "${asset.kind}" asset; expected "${expected}"`,
      );
    }
    if (hasSlot(s) && (!("slotId" in asset) || asset.slotId !== s.slotId)) {
      c.error(
        "ASSET_SLOT_MISMATCH",
        `${path}.slotId`,
        `segment claims slot "${s.slotId}" but asset "${asset.id}" fills ` +
          `"${"slotId" in asset ? asset.slotId : "no slot"}"`,
      );
    }
  });

  edl.promptSegments.forEach((prompt, i) => {
    const path = `promptSegments[${i}]`;
    noteId(prompt.id, `${path}.id`);
    checkGridAndLength(prompt, path, edl.fps, minDurationMs, c);

    if (!isRecordedPrompt(prompt)) return;
    const asset = assets.get(prompt.assetId);
    if (asset === undefined) {
      c.error(
        "UNKNOWN_ASSET",
        `${path}.assetId`,
        `asset "${prompt.assetId}" is not in the manifest`,
      );
      return;
    }
    const expectedKind = prompt.mode === "live-interviewer" ? "interview" : "audio";
    if (asset.kind !== expectedKind) {
      c.error(
        "ASSET_KIND_MISMATCH",
        `${path}.assetId`,
        `${prompt.mode} prompt references a "${asset.kind}" asset; expected "${expectedKind}"`,
      );
    }
    if (!("questionId" in asset) || asset.questionId !== prompt.questionId) {
      c.error(
        "ASSET_QUESTION_MISMATCH",
        `${path}.questionId`,
        `prompt claims question "${prompt.questionId}" but asset "${asset.id}" belongs to ` +
          `"${"questionId" in asset ? asset.questionId : "no question"}"`,
      );
    }
  });

  edl.speechSegments.forEach((s, i) => {
    const path = `speechSegments[${i}]`;
    noteId(s.id, `${path}.id`);
    checkGridAndLength(s, path, edl.fps, minDurationMs, c);

    const asset = assets.get(s.assetId);
    if (asset === undefined) {
      c.error("UNKNOWN_ASSET", `${path}.assetId`, `asset "${s.assetId}" is not in the manifest`);
      return;
    }
    if (asset.kind !== "interview") {
      c.error(
        "ASSET_KIND_MISMATCH",
        `${path}.assetId`,
        `speech references a "${asset.kind}" asset; speech comes from interview clips`,
      );
      return;
    }
    if (asset.questionId !== s.questionId) {
      c.error(
        "ASSET_QUESTION_MISMATCH",
        `${path}.questionId`,
        `speech claims question "${s.questionId}" but asset "${asset.id}" ` +
          `answers "${asset.questionId}"`,
      );
    }
  });
};

const checkGridAndLength = (
  s: { startMs: number; durationMs: number },
  path: string,
  fps: number,
  minDurationMs: number,
  c: IssueCollector,
): void => {
  if (s.durationMs < minDurationMs) {
    c.error(
      "SEGMENT_TOO_SHORT",
      `${path}.durationMs`,
      `${s.durationMs}ms is shorter than two frames (${minDurationMs}ms); ` +
        "it can round away to nothing",
    );
  }
  // A warning, not an error: off-grid times render, they just round. Authored
  // EDLs should stay on the grid; a future compose stage snapping to real
  // musical downbeats may legitimately land between frames.
  for (const [field, value] of [
    ["startMs", s.startMs],
    ["durationMs", s.durationMs],
  ] as const) {
    if (!isFrameAligned(value, fps)) {
      c.warn(
        "TIME_NOT_FRAME_ALIGNED",
        `${path}.${field}`,
        `${value}ms does not land on a frame boundary at ${fps}fps and will be rounded`,
      );
    }
  }
};

export const assetDurationOf = (
  asset: AssetEntry | undefined,
): number | undefined => asset?.durationMs;
