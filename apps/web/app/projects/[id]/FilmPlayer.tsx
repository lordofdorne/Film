"use client";

import { Player } from "@remotion/player";
import { FilmComposition, msToFrame, type FilmProps } from "@film/render/composition";

/**
 * The preview is the SAME composition the render worker uses: the identical
 * React tree, given the identical EDL. Only media playback differs, because a
 * browser plays video and a worker extracts frames.
 *
 * Its own module so the page can load it only when there is a film to show.
 */
export const FilmPlayer = ({ props }: { readonly props: FilmProps }) => (
  <Player
    component={FilmComposition}
    inputProps={props}
    durationInFrames={msToFrame(props.edl.totalDurationMs, props.format.fps)}
    fps={props.format.fps}
    compositionWidth={props.format.width}
    compositionHeight={props.format.height}
    style={{ width: "100%" }}
    controls
    doubleClickToFullscreen
    acknowledgeRemotionLicense
  />
);
