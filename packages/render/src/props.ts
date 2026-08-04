import type { EDL } from "@film/edl";
import type { Format } from "@film/formats";
import type { TemplateStyling } from "@film/templates";

/**
 * Everything the composition needs, as plain serialisable data.
 *
 * Asset URLs are resolved immediately before preview or render and passed in
 * here — they never live in the EDL, which carries only stable ids. In Phase 1
 * these are paths relative to Remotion's public directory (the generated
 * fixtures/); in production they will be short-lived signed URLs.
 */
export type FilmProps = {
  readonly edl: EDL;
  readonly format: Format;
  readonly styling: TemplateStyling;
  /** Template text keys resolved for this subject. */
  readonly text: Readonly<Record<string, string>>;
  /** assetId -> path, relative to the public directory. */
  readonly assetPaths: Readonly<Record<string, string>>;
  /** assetId -> intrinsic pixel size, so framing needs no image probing. */
  readonly assetSizes: Readonly<Record<string, { width: number; height: number }>>;
  readonly musicPath: string;
  readonly audio: {
    readonly duckAttackMs: number;
    readonly duckReleaseMs: number;
    readonly fadeInMs: number;
    readonly fadeOutMs: number;
  };
};

export const assetPath = (props: FilmProps, assetId: string): string => {
  const path = props.assetPaths[assetId];
  if (path === undefined) {
    throw new Error(`no path supplied for asset "${assetId}"`);
  }
  return path;
};

export const assetSize = (
  props: FilmProps,
  assetId: string,
): { width: number; height: number } => {
  const size = props.assetSizes[assetId];
  if (size === undefined) {
    throw new Error(`no intrinsic size supplied for asset "${assetId}"`);
  }
  return size;
};

export const resolvedText = (props: FilmProps, key: string): string => {
  const value = props.text[key];
  if (value === undefined) {
    throw new Error(
      `text key "${key}" was not resolved; interpolation must fail before render, not during it`,
    );
  }
  return value;
};
