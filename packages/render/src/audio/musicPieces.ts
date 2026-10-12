/**
 * The music bed as the stretches of track it is made of.
 *
 * With no edits it is one piece: the track from `musicStartMs`, for the whole
 * film, exactly as before. Each music edit ends one piece and starts the next,
 * and the two overlap for the edit's crossfade, centred on it — the outgoing
 * piece fading out as the incoming one fades in.
 *
 * Pure arithmetic, so it is tested on its own; MusicBed only draws it.
 */
export type MusicPiece = {
  /** Timeline window this piece plays in, crossfades included. */
  readonly fromMs: number;
  readonly toMs: number;
  /** Track time at `fromMs`. */
  readonly trackFromMs: number;
  /** Crossfade lengths at either end; 0 at the film's own start and end. */
  readonly fadeInMs: number;
  readonly fadeOutMs: number;
};

export const musicPiecesOf = (
  audio: {
    readonly musicStartMs: number;
    readonly musicEdits?: readonly { readonly atMs: number; readonly toMs: number; readonly crossfadeMs: number }[] | undefined;
  },
  totalDurationMs: number,
): MusicPiece[] => {
  const edits = audio.musicEdits ?? [];
  const pieces: MusicPiece[] = [];
  let fromMs = 0;
  let trackFromMs = audio.musicStartMs;
  let fadeInMs = 0;
  for (const edit of edits) {
    const half = edit.crossfadeMs / 2;
    pieces.push({ fromMs, toMs: edit.atMs + half, trackFromMs, fadeInMs, fadeOutMs: edit.crossfadeMs });
    fromMs = edit.atMs - half;
    trackFromMs = edit.toMs - half;
    fadeInMs = edit.crossfadeMs;
  }
  pieces.push({ fromMs, toMs: totalDurationMs, trackFromMs, fadeInMs, fadeOutMs: 0 });
  return pieces;
};

/**
 * Equal-power crossfade gain for a piece at timeline `ms`: 1 in the middle,
 * a quarter sine in and out. Equal power rather than linear, so the music
 * does not dip in loudness halfway through the edit.
 */
export const crossfadeGainAt = (piece: MusicPiece, ms: number): number => {
  const intoPiece = ms - piece.fromMs;
  const untilEnd = piece.toMs - ms;
  const fadeIn = piece.fadeInMs > 0 ? Math.sin((Math.min(Math.max(intoPiece / piece.fadeInMs, 0), 1) * Math.PI) / 2) : 1;
  const fadeOut = piece.fadeOutMs > 0 ? Math.sin((Math.min(Math.max(untilEnd / piece.fadeOutMs, 0), 1) * Math.PI) / 2) : 1;
  return Math.min(fadeIn, fadeOut);
};
