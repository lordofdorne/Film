import type { assets, projects } from "@film/db";
import { AssetManifestSchema, type AssetManifest, type MusicTrackInfo } from "@film/edl";
import { z } from "zod";

import type { SpeechRun } from "./media/ffmpeg.js";
import type { TempBedConfig } from "./media/musicBed.js";

export type AssetRow = typeof assets.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

/**
 * The music bed is an asset row but not a manifest asset.
 *
 * It has a project-scoped storage key and metadata like everything else, so
 * the assets table is the right home for it. But the manifest describes media
 * the EDL's segments point at, and the bed is reached through
 * `audio.musicTrackId` instead — the audio entry schema requires a questionId
 * precisely because the only audio the picture references is an interviewer's
 * question. So the bed is filtered out on the way into the manifest.
 */
export const MUSIC_BED_SLOT = "music_bed";

/** Edit decisions that belong to the project rather than to the subject. */
export const ProjectConfigSchema = z
  .object({
    /** Questions that get an on-screen prompt card before the answer. */
    questionPrompts: z.array(z.string()).default([]),
    music: z
      .object({
        trackId: z.string(),
        title: z.string(),
        cropStartMs: z.number().int().nonnegative(),
        cropEndMs: z.number().int().positive(),
        crossfadeMs: z.number().int().nonnegative(),
        targetDurationMs: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const parseProjectConfig = (raw: unknown): ProjectConfig =>
  ProjectConfigSchema.parse(raw ?? {});

/**
 * What the source text of an answer is, and where it comes from.
 *
 * Today intake supplies it, because there is no transcription step: the words
 * are typed in and must match the take. Phase 4 replaces the source, not the
 * shape — this is the selection made from an answer, which is exactly what a
 * transcript plus a word-range choice produces.
 */
export const AssetSelectionSchema = z
  .object({
    spoken: z.string().min(1),
    coldOpen: z.string().min(1).optional(),
    emphasis: z
      .object({
        phrase: z.string().min(1),
        tone: z.enum(["funny", "meaningful", "surprising"]),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AssetSelection = z.infer<typeof AssetSelectionSchema>;

/** What ingest measured. Written by ingest, read by compose and the web app. */
export type AssetQcMetrics = {
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  /** Interview takes only: where speech actually starts and stops. */
  readonly speechRuns?: readonly SpeechRun[];
  /** The music bed only: the track the validator has to resolve. */
  readonly musicTrack?: MusicTrackInfo;
  /** The music bed only: how it was built, so a rebuild is reproducible. */
  readonly bed?: TempBedConfig;
};

export type AssetWarning = { readonly code: string; readonly message: string };

export const qcOf = (row: AssetRow): AssetQcMetrics => (row.qcMetrics ?? {}) as AssetQcMetrics;
export const warningsOf = (row: AssetRow): readonly AssetWarning[] =>
  (row.warnings ?? []) as AssetWarning[];

export const isMusicBed = (row: AssetRow): boolean =>
  row.kind === "audio" && row.slotId === MUSIC_BED_SLOT;

/** Every asset the film is actually cut from. */
export const filmAssets = (rows: readonly AssetRow[]): AssetRow[] =>
  rows.filter((r) => !isMusicBed(r));

/**
 * The manifest, derived from what ingest measured.
 *
 * Deliberately strict: a row that has not been ingested has no dimensions, and
 * inventing a default here would let a film be composed against a size nobody
 * measured. Compose should not have been dispatched yet in that case, so the
 * throw is a dispatcher bug rather than a customer's problem.
 */
export const buildManifest = (rows: readonly AssetRow[]): AssetManifest => {
  const entries = filmAssets(rows).map((row) => {
    const qc = qcOf(row);
    const missing = (field: string): never => {
      throw new Error(
        `asset ${row.id} (${row.kind}) has no ${field}; it has not been ingested`,
      );
    };

    if (row.kind === "audio") {
      return {
        id: row.id,
        kind: "audio" as const,
        questionId: row.questionId ?? missing("questionId"),
        durationMs: qc.durationMs ?? missing("durationMs"),
      };
    }

    const size = {
      width: qc.width ?? missing("width"),
      height: qc.height ?? missing("height"),
    };

    if (row.kind === "photo") {
      return { id: row.id, kind: "photo" as const, slotId: row.slotId ?? missing("slotId"), ...size };
    }
    if (row.kind === "interview") {
      return {
        id: row.id,
        kind: "interview" as const,
        questionId: row.questionId ?? missing("questionId"),
        durationMs: qc.durationMs ?? missing("durationMs"),
        ...size,
      };
    }
    return {
      id: row.id,
      kind: "video" as const,
      slotId: row.slotId ?? missing("slotId"),
      durationMs: qc.durationMs ?? missing("durationMs"),
      ...size,
    };
  });

  return AssetManifestSchema.parse({ assets: entries });
};

/** The file extension ingest writes for each kind of source. */
export const normalisedName = (row: AssetRow): string => {
  if (row.kind === "photo") return "normalised.jpg";
  if (row.kind === "audio") return "normalised.wav";
  return "normalised.mp4";
};
