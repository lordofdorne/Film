import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  Issue,
  IssueCode,
  MusicTrackInfo,
  ValidationContext,
  ValidationResult,
} from "../src/index.js";
import { AssetManifestSchema } from "../src/index.js";

const repoFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

export const VALID_EDL: unknown = JSON.parse(repoFile("sample/life-advice.edl.json"));
export const MANIFEST = AssetManifestSchema.parse(
  JSON.parse(repoFile("sample/life-advice.manifest.json")),
);

/**
 * The placeholder tone bed, described here rather than imported from
 * @film/music: these tests exist partly to prove @film/edl needs no knowledge
 * of the music library or the template registry to validate an EDL.
 */
export const PLACEHOLDER_TRACK: MusicTrackInfo = {
  id: "placeholder-tone-bed",
  durationMs: 240_000,
  beatGridMs: Array.from({ length: 75 }, (_, i) => i * 3200),
  cues: {
    openingMs: 0,
    titleMs: 9_000,
    lifts: [56_000, 80_000, 141_000],
    resolutionMs: 169_000,
    endingMs: 192_000,
  },
  licenseRef: "PLACEHOLDER — not for production",
  usage: "fixture-only",
  available: false,
};

/** life-advice@1 conformance, inlined for the same reason. */
export const CONFORMANCE = {
  templateId: "life-advice",
  templateVersion: 1,
  maxEmphasisPerFilm: 2,
  maxConsecutivePhotos: 2,
  requiredPhotoSlotIds: ["photo_early", "photo_personality", "photo_group"],
  requiredVideoSlotIds: ["video_group", "video_personality"],
  questionIds: [
    "identity_name",
    "identity_age",
    "identity_birth_year",
    "longevity",
    "greatest_lesson",
    "advice_for_young_people",
    "meaning_of_group",
    "love_lesson",
    "closing_message",
    "bonus_interviewer",
  ],
  interviewScales: [1, 1.06, 1.1],
  targetDurationMs: { min: 210_000, max: 230_000 },
} as const;

export const baseContext = (
  overrides: Partial<ValidationContext> = {},
): ValidationContext => ({
  manifest: MANIFEST,
  format: { id: "landscape-classic", width: 1440, height: 1080, fps: 30 },
  conformance: CONFORMANCE,
  resolveMusicTrack: (id) => (id === PLACEHOLDER_TRACK.id ? PLACEHOLDER_TRACK : undefined),
  allowPlaceholderMusic: true,
  ...overrides,
});

/* ── mutation helpers ────────────────────────────────────────────────────
   Every invalid case is the valid sample with exactly one thing changed, so
   the defect under test is visible at the assertion instead of buried in a
   near-identical 500-line JSON file. */

export type Rec = Record<string, unknown>;

export const clone = (): Rec => structuredClone(VALID_EDL) as Rec;

const list = (edl: Rec, track: "visualSegments" | "speechSegments"): Rec[] =>
  edl[track] as Rec[];

export const visual = (edl: Rec, id: string): Rec => {
  const found = list(edl, "visualSegments").find((s) => s["id"] === id);
  if (found === undefined) throw new Error(`no visual segment "${id}" in sample`);
  return found;
};

export const speech = (edl: Rec, id: string): Rec => {
  const found = list(edl, "speechSegments").find((s) => s["id"] === id);
  if (found === undefined) throw new Error(`no speech segment "${id}" in sample`);
  return found;
};

export const visuals = (edl: Rec): Rec[] => list(edl, "visualSegments");
export const speeches = (edl: Rec): Rec[] => list(edl, "speechSegments");
export const audio = (edl: Rec): Rec => edl["audio"] as Rec;

/* ── assertions ──────────────────────────────────────────────────────── */

export const codesOf = (issues: readonly Issue[]): IssueCode[] =>
  issues.map((i) => i.code);

export const describeResult = (r: ValidationResult): string =>
  r.ok
    ? `ok (warnings: ${codesOf(r.warnings).join(", ") || "none"})`
    : `errors: ${codesOf(r.errors).join(", ")}`;
