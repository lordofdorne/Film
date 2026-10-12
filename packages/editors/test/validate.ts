import { validateEdl, type EDL, type MusicTrackInfo } from "@film/edl";
import { getFormat } from "@film/formats";
import { toConformance, type Template } from "@film/templates";

import type { ComposeInput } from "../src/material.js";

/**
 * What the compose stage runs on every cut before storing it, with a manifest
 * made from the test's own input. An editor's output is not a film until this
 * says so.
 */
export const validate = (input: ComposeInput & { template: Template }, edl: EDL, track?: MusicTrackInfo) =>
  validateEdl(edl, {
    manifest: {
      assets: [
        ...input.answers.map((a) => ({
          id: a.assetId,
          kind: "interview" as const,
          questionId: a.questionId,
          durationMs: input.assetDurationMs[a.assetId] ?? a.durationMs,
          width: 1920,
          height: 1080,
        })),
        ...input.stills.map((s) => ({ id: s.assetId, kind: "photo" as const, slotId: s.slotId, width: 1920, height: 1080 })),
        ...Object.entries(input.brollAssetIds).map(([slotId, assetId]) => ({
          id: assetId,
          kind: "video" as const,
          slotId,
          durationMs: input.assetDurationMs[assetId] ?? 40_000,
          width: 1920,
          height: 1080,
        })),
      ],
    },
    format: getFormat(input.template.defaultFormatId),
    conformance: toConformance(input.template),
    resolveMusicTrack: () => track ?? ({
      id: "temp",
      durationMs: 400_000,
      beatGridMs: [...input.track.beatGridMs],
      cues: {
        openingMs: 0,
        titleMs: input.track.cues.titleMs,
        lifts: [60_000, 120_000, 180_000],
        resolutionMs: 240_000,
        endingMs: 300_000,
      },
      licenseRef: null,
      usage: "fixture-only",
      available: true,
    } satisfies MusicTrackInfo),
    allowPlaceholderMusic: true,
  });
