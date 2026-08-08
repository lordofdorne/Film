import { staticFile } from "remotion";

/** Schemes that are already a complete address and must be left alone. */
const ABSOLUTE = /^(https?:|blob:|data:|file:)/i;

/**
 * Turn a stored asset path into something a <Video>, <Audio> or <Img> can load.
 *
 * The same composition runs in two very different places, and they disagree
 * about what a path means:
 *
 *   server render — Remotion serves a public directory, and a relative path
 *                   like "interview/asset_x.mp4" resolves against it.
 *   browser player — there is no public directory. Assets live in private
 *                   storage and arrive as short-lived signed URLs, already
 *                   absolute.
 *
 * Rather than fork the composition — which would break preview parity, the
 * property that makes browser approval possible at all — the caller supplies
 * whichever form it has and this passes absolute URLs straight through.
 *
 * staticFile() throws on an absolute URL, so without this the Player fails on
 * the first frame that touches media.
 */
export const resolveSrc = (pathOrUrl: string): string =>
  ABSOLUTE.test(pathOrUrl) ? pathOrUrl : staticFile(pathOrUrl);

export const isAbsoluteSrc = (pathOrUrl: string): boolean => ABSOLUTE.test(pathOrUrl);

/**
 * True when the composition is running inside <Player> rather than a headless
 * render. Remotion sets this flag on the window; there is no import that
 * distinguishes the two.
 */
export const isPlayer = (): boolean =>
  typeof window !== "undefined" &&
  (window as { remotion_isPlayer?: boolean }).remotion_isPlayer === true;
