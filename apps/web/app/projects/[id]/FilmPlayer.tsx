"use client";

import { Player } from "@remotion/player";
import { memo } from "react";
import { FilmComposition, msToFrame, type FilmProps } from "@film/render/composition";

/**
 * The preview is the SAME composition the render worker uses: the identical
 * React tree, given the identical EDL. Only media playback differs, because a
 * browser plays video and a worker extracts frames.
 *
 * Its own module so the page can load it only when there is a film to show.
 *
 * Memoised: the page around it re-renders for every "Got it" and for Approve,
 * and the player has nothing new to draw for either. The props come from the
 * server and keep their identity until the page is refreshed.
 */
export const FilmPlayer = memo(function FilmPlayer({ props }: { readonly props: FilmProps }) {
  return (
    <Player
      component={FilmComposition}
      inputProps={props}
      durationInFrames={msToFrame(props.edl.totalDurationMs, props.format.fps)}
      fps={props.format.fps}
      compositionWidth={props.format.width}
      compositionHeight={props.format.height}
      style={FULL_WIDTH}
      controls
      doubleClickToFullscreen
      acknowledgeRemotionLicense
    />
  );
});

const FULL_WIDTH = { width: "100%" } as const;
