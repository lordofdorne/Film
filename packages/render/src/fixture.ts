import {
  AssetManifestSchema,
  assertValidEdl,
  type AssetManifest,
  type EDL,
} from "@film/edl";
import { getFormat } from "@film/formats";
import { PLACEHOLDER_TRACK, resolveTrack } from "@film/music";
import {
  getTemplate,
  resolveAllText,
  toConformance,
  type SubjectData,
  type Template,
} from "@film/templates";
import type { FilmProps } from "./props.js";

/**
 * Where the fixture generator writes each kind of asset, relative to the
 * Remotion public directory (which the render script points at fixtures/).
 * This mapping is fixture-specific on purpose: production resolves asset ids
 * to short-lived signed URLs instead, and nothing else changes.
 */
const fixturePath = (id: string, kind: AssetManifest["assets"][number]["kind"]): string => {
  switch (kind) {
    case "interview":
      return `interview/${id}.mp4`;
    case "video":
      return `broll/${id}.mp4`;
    case "photo":
      return `photo/${id}.jpg`;
  }
};

export const FIXTURE_MUSIC_PATH = "music/placeholder-tone-bed.wav";

export type BuildInput = {
  readonly edl: unknown;
  readonly manifest: unknown;
  readonly subject: SubjectData;
};

/**
 * Turn the handwritten sample into composition props.
 *
 * Validation happens HERE, before anything is rendered — the renderer is
 * allowed to assume a valid EDL, and text interpolation is required to succeed
 * up front so that a missing token or an over-long title is a build failure
 * rather than the word "undefined" in a delivered film.
 */
export const buildFixtureProps = (input: BuildInput): FilmProps => {
  const manifest: AssetManifest = AssetManifestSchema.parse(input.manifest);
  const template: Template = getTemplate("life-advice", 1);
  const format = getFormat(template.defaultFormatId);

  const edl: EDL = assertValidEdl(input.edl, {
    manifest,
    format,
    conformance: toConformance(template),
    resolveMusicTrack: (id) => resolveTrack(id),
    // The synthetic tone bed is permitted only because this is the fixture
    // path. Production leaves this false and the same EDL would be rejected.
    allowPlaceholderMusic: true,
  });

  const text = resolveAllText(template, input.subject, format);
  if (!text.ok) {
    throw new Error(`template text did not resolve:\n  ${text.failures.join("\n  ")}`);
  }

  const assetPaths: Record<string, string> = {};
  const assetSizes: Record<string, { width: number; height: number }> = {};
  for (const asset of manifest.assets) {
    assetPaths[asset.id] = fixturePath(asset.id, asset.kind);
    assetSizes[asset.id] = { width: asset.width, height: asset.height };
  }

  return {
    edl,
    format,
    styling: template.styling,
    text: text.text,
    assetPaths,
    assetSizes,
    musicPath: FIXTURE_MUSIC_PATH,
    audio: {
      duckAttackMs: template.audioDefaults.duckAttackMs,
      duckReleaseMs: template.audioDefaults.duckReleaseMs,
      // Head and tail fades sized off the track's own cue sheet rather than
      // hardcoded: the bed should be up by the opening cue and gone by the end.
      fadeInMs: 1_500,
      fadeOutMs: Math.max(
        2_000,
        PLACEHOLDER_TRACK.durationMs - PLACEHOLDER_TRACK.cues.endingMs > 0 ? 2_500 : 2_000,
      ),
    },
  };
};

/**
 * When interview fixtures are silent (reference-music mode), leave the bed
 * unducked and a little hotter so loudnorm can still hit −14 LUFS. Applied via
 * render inputProps — the Remotion bundle cannot read the fixtures/ marker.
 */
export const withoutMusicDuck = (props: FilmProps): FilmProps => ({
  ...props,
  audio: {
    ...props.audio,
    duckDb: 0,
    musicGainDb: -8,
  },
});
