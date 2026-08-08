import { AssetManifestSchema, assertValidEdl, type AssetManifest, type EDL, type MusicTrackInfo } from "@film/edl";
import { getFormat } from "@film/formats";
import { resolveTrack } from "@film/music";
import { getTemplate, resolveAllText, toConformance, type SubjectData } from "@film/templates";
import type { FilmProps } from "./props.js";

export type ProjectPropsInput = {
  readonly edl: unknown;
  readonly manifest: unknown;
  readonly subject: SubjectData;
  readonly templateId: string;
  readonly templateVersion: number;
  /** assetId -> wherever the caller can serve that asset from. */
  readonly assetPaths: Readonly<Record<string, string>>;
  readonly musicPath: string;
  /** A track belonging to this project rather than to the shared registry. */
  readonly musicTrack?: MusicTrackInfo | undefined;
  /** Development and fixture callers only. Production leaves this false. */
  readonly allowPlaceholderMusic?: boolean;
};

/**
 * One assembly of composition props, used by both the browser preview and the
 * delivery render.
 *
 * "Preview is the same composition as delivery" is the property that makes
 * browser approval mean anything, and it does not survive two places building
 * the props. Only the paths differ between the two callers: the worker points
 * at files it has pulled to local disk, the browser at signed URLs. Everything
 * else — validation, text resolution, sizes, audio defaults — happens here.
 *
 * Validation runs HERE, before anything renders. The renderer is allowed to
 * assume a valid EDL, and text interpolation must succeed up front so that a
 * missing token is a failure rather than the word "undefined" in a delivered
 * film.
 */
export const buildProjectProps = (input: ProjectPropsInput): FilmProps => {
  const manifest: AssetManifest = AssetManifestSchema.parse(input.manifest);
  const template = getTemplate(input.templateId, input.templateVersion);
  const format = getFormat(template.defaultFormatId);

  const edl: EDL = assertValidEdl(input.edl, {
    manifest,
    format,
    conformance: toConformance(template),
    resolveMusicTrack: (id) => (input.musicTrack?.id === id ? input.musicTrack : resolveTrack(id)),
    allowPlaceholderMusic: input.allowPlaceholderMusic ?? false,
  });

  const text = resolveAllText(template, input.subject, format);
  if (!text.ok) {
    throw new Error(`template text did not resolve:\n  ${text.failures.join("\n  ")}`);
  }

  const assetSizes: Record<string, { width: number; height: number }> = {};
  for (const asset of manifest.assets) {
    if (asset.kind !== "audio") {
      assetSizes[asset.id] = { width: asset.width, height: asset.height };
    }
    if (input.assetPaths[asset.id] === undefined) {
      throw new Error(`no path was resolved for asset "${asset.id}"`);
    }
  }

  return {
    edl,
    format,
    styling: template.styling,
    text: text.text,
    assetPaths: input.assetPaths,
    assetSizes,
    musicPath: input.musicPath,
    audio: {
      duckAttackMs: template.audioDefaults.duckAttackMs,
      duckReleaseMs: template.audioDefaults.duckReleaseMs,
      fadeInMs: 1_500,
      fadeOutMs: 2_500,
    },
  };
};
