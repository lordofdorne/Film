import type { VisualSegment } from "@film/edl";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { framePhoto, frameStyle, frameVideo } from "../framing/photoFraming.js";
import { assetPath, assetSize, resolvedText, type FilmProps } from "../props.js";
import { OverlayText } from "../text/OverlayText.js";
import { SequentialReveal } from "../text/SequentialReveal.js";
import type { Theme } from "../theme.js";
import type { VisualWindow } from "../timing/windows.js";
import { PictureOnlyVideo } from "../video/PictureOnlyVideo.js";
import { msToFrame } from "../timing/windows.js";

/**
 * One visual segment, drawn inside its own <Sequence>. `frame` here is
 * relative to the segment's start, which is what makes every animation below a
 * pure function of position within the segment rather than of absolute time.
 */
export const VisualSegmentView = ({
  window,
  props,
  theme,
}: {
  readonly window: VisualWindow;
  readonly props: FilmProps;
  readonly theme: Theme;
}) => {
  const frame = useCurrentFrame();
  const { segment, transitionFrames, transitionType, durationInFrames } = window;

  /**
   * Both crossfade and fade ramp the incoming segment's opacity. They differ
   * in what sits underneath: for a crossfade the previous segment is still
   * being drawn, for a fade it has already stopped (its window was truncated),
   * so the ramp happens over black. One opacity ramp, two readings.
   */
  const opacity =
    transitionType === "cut" || transitionFrames === 0
      ? 1
      : interpolate(frame, [0, transitionFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const progress = durationInFrames <= 1 ? 0 : frame / (durationInFrames - 1);

  return (
    <AbsoluteFill style={{ opacity }}>
      <SegmentBody
        segment={segment}
        props={props}
        theme={theme}
        progress={progress}
        frame={frame}
      />
      {segment.overlayTextKey !== undefined && (
        <OverlayText text={resolvedText(props, segment.overlayTextKey)} theme={theme} />
      )}
    </AbsoluteFill>
  );
};

const SegmentBody = ({
  segment,
  props,
  theme,
  progress,
  frame,
}: {
  readonly segment: VisualSegment;
  readonly props: FilmProps;
  readonly theme: Theme;
  readonly progress: number;
  readonly frame: number;
}) => {
  const { format } = props;

  switch (segment.kind) {
    case "black":
      return (
        <AbsoluteFill
          style={{
            backgroundColor: theme.title.background,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {segment.textKey !== undefined && (
            <SequentialReveal
              text={resolvedText(props, segment.textKey)}
              theme={theme}
              mode="fade"
            />
          )}
        </AbsoluteFill>
      );

    case "title":
      return (
        <AbsoluteFill
          style={{
            backgroundColor: theme.title.background,
            alignItems: "center",
            justifyContent: "center",
            padding: `${theme.safe.y}px ${theme.safe.x}px`,
          }}
        >
          <SequentialReveal
            text={resolvedText(props, segment.textKey)}
            theme={theme}
            mode={segment.reveal}
          />
        </AbsoluteFill>
      );

    case "interview": {
      const size = assetSize(props, segment.assetId);
      const box = frameVideo({
        sourceWidth: size.width,
        sourceHeight: size.height,
        outWidth: format.width,
        outHeight: format.height,
        scale: segment.scale,
      });
      return (
        <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
          <PictureOnlyVideo
            src={staticFile(assetPath(props, segment.assetId))}
            trimBefore={msToFrame(segment.sourceInMs, format.fps)}
            trimAfter={msToFrame(segment.sourceOutMs, format.fps)}
            style={frameStyle(box)}
          />
        </AbsoluteFill>
      );
    }

    case "broll": {
      const size = assetSize(props, segment.assetId);
      const box = frameVideo({
        sourceWidth: size.width,
        sourceHeight: size.height,
        outWidth: format.width,
        outHeight: format.height,
        scale: 1,
      });
      return (
        <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
          <PictureOnlyVideo
            src={staticFile(assetPath(props, segment.assetId))}
            trimBefore={msToFrame(segment.sourceInMs, format.fps)}
            trimAfter={msToFrame(segment.sourceOutMs, format.fps)}
            style={frameStyle(box)}
          />
        </AbsoluteFill>
      );
    }

    case "photo": {
      const size = assetSize(props, segment.assetId);
      const box = framePhoto({
        sourceWidth: size.width,
        sourceHeight: size.height,
        outWidth: format.width,
        outHeight: format.height,
        focalPoint: segment.focalPoint,
        motion: segment.motion,
        intensity: segment.intensity,
        progress,
      });

      /**
       * insetExpand: the photo enters slightly inset and settles out to full
       * bleed. Only meaningful on a hard cut — you cannot inset-expand out of
       * a dissolve, so it is ignored when the segment enters on a transition.
       */
      const useInset = segment.entry === "insetExpand" && segment.transitionIn.type === "cut";
      const insetFrames = 12;
      const inset = useInset
        ? interpolate(frame, [0, insetFrames], [0.055, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 0;
      const radius = useInset
        ? interpolate(frame, [0, insetFrames], [0.02, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 0;

      return (
        <AbsoluteFill style={{ backgroundColor: "#000" }}>
          <AbsoluteFill
            style={{
              transform: `scale(${1 - inset})`,
              borderRadius: radius * format.width,
              overflow: "hidden",
            }}
          >
            <Img src={staticFile(assetPath(props, segment.assetId))} style={frameStyle(box)} />
          </AbsoluteFill>
        </AbsoluteFill>
      );
    }
  }
};
