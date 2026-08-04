import type { AssetManifest } from "../schema/manifest.js";

/**
 * The minimum a music track must expose for validation. Declared structurally
 * rather than imported from @film/music so that @film/edl keeps zero package
 * dependencies and the engine stays ignorant of the music library.
 */
export type MusicCueSheetInfo = {
  readonly openingMs: number;
  readonly titleMs: number;
  readonly lifts: readonly number[];
  readonly resolutionMs: number;
  readonly endingMs: number;
};

export type MusicTrackInfo = {
  readonly id: string;
  readonly durationMs: number;
  readonly beatGridMs: readonly number[];
  readonly cues: MusicCueSheetInfo;
  readonly licenseRef: string | null;
  readonly usage: string;
  readonly available: boolean;
};

export type FormatInfo = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
};

/**
 * Template rules as DATA, not code. This is what keeps the promise that a
 * second template requires zero engine changes: conformance is supplied by
 * whoever owns the template, and the validator only knows how to check it.
 */
export type TemplateConformance = {
  readonly templateId: string;
  readonly templateVersion: number;
  readonly maxEmphasisPerFilm: number;
  readonly maxConsecutivePhotos: number;
  readonly requiredPhotoSlotIds: readonly string[];
  readonly requiredVideoSlotIds: readonly string[];
  readonly questionIds: readonly string[];
  readonly interviewScales: readonly number[];
  readonly minPromptAnswerGapMs: number;
  readonly targetDurationMs: { readonly min: number; readonly max: number };
};

export type ValidationContext = {
  readonly manifest: AssetManifest;
  readonly format: FormatInfo;
  readonly conformance: TemplateConformance;
  readonly resolveMusicTrack: (id: string) => MusicTrackInfo | undefined;
  /**
   * Fixture and test contexts only. Lets the synthetic tone bed pass the
   * "must resolve to a licensed registry entry" rule. Defaults to false so a
   * production path cannot accidentally ship placeholder music.
   */
  readonly allowPlaceholderMusic?: boolean;
};

/** One frame at 30fps, rounded up. The lip-sync agreement tolerance. */
export const LIP_SYNC_TOLERANCE_MS = 33;
