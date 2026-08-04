import type { EDL, SpeechSegment, VisualSegment } from "@film/edl";

/**
 * Absolute frame index for a timeline position. Windows are derived by
 * differencing two absolute positions rather than by rounding a duration, so
 * rounding error cannot accumulate along the timeline.
 */
export const msToFrame = (ms: number, fps: number): number =>
  Math.round((ms * fps) / 1000);

export type VisualWindow = {
  readonly segment: VisualSegment;
  readonly fromFrame: number;
  /**
   * May be shorter than the segment's own duration: when the NEXT segment
   * enters on a `fade`, this one stops being drawn for that overlap so the
   * incoming segment rises out of black rather than out of a dissolve.
   */
  readonly durationInFrames: number;
  /** This segment's own transitionIn, in frames. Drives its opacity ramp. */
  readonly transitionFrames: number;
  readonly transitionType: VisualSegment["transitionIn"]["type"];
};

/**
 * Visual segments are emitted in array order, so a later segment paints over
 * an earlier one. Combined with the contiguity rule — a segment overlaps only
 * its predecessor, and only by its declared transition — that makes the
 * incoming segment's opacity ramp the whole of a crossfade.
 */
export const visualWindows = (edl: EDL): VisualWindow[] => {
  const { fps } = edl;
  return edl.visualSegments.map((segment, i) => {
    const next = edl.visualSegments[i + 1];
    const fromFrame = msToFrame(segment.startMs, fps);

    const hiddenTailMs =
      next?.transitionIn.type === "fade" ? next.transitionIn.durationMs : 0;
    const visibleEndMs = segment.startMs + segment.durationMs - hiddenTailMs;

    return {
      segment,
      fromFrame,
      durationInFrames: Math.max(1, msToFrame(visibleEndMs, fps) - fromFrame),
      transitionFrames: msToFrame(segment.transitionIn.durationMs, fps),
      transitionType: segment.transitionIn.type,
    };
  });
};

export type SpeechWindow = {
  readonly segment: SpeechSegment;
  readonly fromFrame: number;
  readonly durationInFrames: number;
};

export const speechWindows = (edl: EDL): SpeechWindow[] => {
  const { fps } = edl;
  return edl.speechSegments.map((segment) => {
    const fromFrame = msToFrame(segment.startMs, fps);
    return {
      segment,
      fromFrame,
      durationInFrames: Math.max(
        1,
        msToFrame(segment.startMs + segment.durationMs, fps) - fromFrame,
      ),
    };
  });
};

/** Speech boundaries in ms — the only input to the music envelope. */
export const speechIntervals = (edl: EDL): ReadonlyArray<readonly [number, number]> =>
  edl.speechSegments.map((s) => [s.startMs, s.startMs + s.durationMs] as const);
