import { z } from "zod";

/**
 * Cue names and their narrative order are fixed per template. Times differ per
 * track; structure does not. That is what makes swapping tracks a re-compose
 * rather than a re-edit.
 */
export const MusicCueSheetSchema = z
  .object({
    openingMs: z.number().int().nonnegative(),
    titleMs: z.number().int().nonnegative(),
    /** Emotional lifts, ascending. */
    lifts: z.array(z.number().int().nonnegative()),
    resolutionMs: z.number().int().nonnegative(),
    endingMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine((c) => c.lifts.every((v, i) => i === 0 || v > (c.lifts[i - 1] ?? -1)), {
    message: "lifts must be ascending",
    path: ["lifts"],
  });

export const MusicTrackSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    licensor: z.string().min(1),
    /** License id or contract reference. Null means not cleared for output. */
    licenseRef: z.string().min(1).nullable(),
    /**
     * "licensed"                for production tracks
     * "fixture-only"            for generated placeholders
     * "creative-reference-only" for a mood reference — must never be an asset
     */
    usage: z.enum(["licensed", "fixture-only", "creative-reference-only"]),
    /** Path or R2 key for the mastered instrumental. Null when unlicensed. */
    assetKey: z.string().min(1).nullable(),
    durationMs: z.number().int().positive(),
    bpm: z.number().positive(),
    /** Downbeats, precomputed at ingest — never analysed at compose or render. */
    beatGridMs: z.array(z.number().int().nonnegative()),
    cues: MusicCueSheetSchema,
    mood: z.array(z.string().min(1)),
    /** False retires a track for new projects without breaking existing ones. */
    available: z.boolean(),
  })
  .strict();

export type MusicCueSheet = z.infer<typeof MusicCueSheetSchema>;
export type MusicTrack = z.infer<typeof MusicTrackSchema>;

/** Downbeats every `barMs` across `durationMs`, inclusive of zero. */
export const buildBeatGrid = (durationMs: number, barMs: number): number[] => {
  if (!Number.isInteger(barMs) || barMs <= 0) {
    throw new Error(`barMs must be a positive integer, got ${barMs}`);
  }
  const grid: number[] = [];
  for (let t = 0; t < durationMs; t += barMs) grid.push(t);
  return grid;
};

/**
 * 75bpm, not the 72 originally sketched.
 *
 * At 72bpm a bar is 3333.33ms and no downbeat ever lands on a frame, so
 * beat-alignment assertions against synthetic media would be approximate.
 * 75bpm gives 800ms beats, 3200ms bars, and exactly 75 bars across 240s — all
 * frame-exact. Real licensed tracks will not cooperate; for those, compose
 * snaps to the nearest downbeat and then to the nearest frame, and the
 * validator allows one frame of slack.
 */
const PLACEHOLDER_BPM = 75;
const PLACEHOLDER_BAR_MS = (60_000 / PLACEHOLDER_BPM) * 4; // 3200

export const PLACEHOLDER_TRACK: MusicTrack = MusicTrackSchema.parse({
  id: "placeholder-tone-bed",
  title: "Placeholder Tone Bed",
  licensor: "generated",
  licenseRef: "PLACEHOLDER — not for production",
  usage: "fixture-only",
  assetKey: "fixtures/music/placeholder-tone-bed.wav",
  durationMs: 240_000,
  bpm: PLACEHOLDER_BPM,
  beatGridMs: buildBeatGrid(240_000, PLACEHOLDER_BAR_MS),
  cues: {
    openingMs: 0,
    titleMs: 9_000,
    lifts: [56_000, 80_000, 141_000],
    resolutionMs: 169_000,
    endingMs: 192_000,
  },
  mood: ["placeholder"],
  available: false,
});

/**
 * The reference track is not production music. It is recorded as metadata so
 * the creative intent is not lost, and nothing more.
 *
 * Nothing with usage "creative-reference-only" may be checked into this
 * repository, uploaded to storage, referenced by a MusicTrack's assetKey, or
 * rendered into output. It has no assetKey and no licenseRef, so the validator
 * rejects any EDL that names it.
 */
export const LIFE_ADVICE_MUSIC_REFERENCE = {
  title: "End of August",
  artist: "Noah Kahan",
  album: "The Great Divide",
  usage: "creative-reference-only",
  licensedAssetId: null,
} as const;

/**
 * Versioned data. A track id referenced by an existing project is never
 * removed or replaced — retire it by setting `available: false`.
 *
 * The three production tracks the Life Advice picker will offer are not here
 * yet; they are declared in the template's musicOptions and reported as
 * pending until commissioned.
 */
export const TRACK_REGISTRY: Readonly<Record<string, MusicTrack>> = Object.freeze({
  [PLACEHOLDER_TRACK.id]: PLACEHOLDER_TRACK,
});

export const resolveTrack = (id: string): MusicTrack | undefined =>
  TRACK_REGISTRY[id];

/** Tracks a customer may actually choose. */
export const availableTracks = (): MusicTrack[] =>
  Object.values(TRACK_REGISTRY).filter((t) => t.available && t.usage === "licensed");
