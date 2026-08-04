import type { PhotoSegment } from "@film/edl";

/**
 * Where and how large to draw an image inside the composition.
 * Origin is the composition's top-left; width/height are the drawn size.
 */
export type Frame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type FramingInput = {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly outWidth: number;
  readonly outHeight: number;
  readonly focalPoint: { readonly x: number; readonly y: number };
  readonly motion: PhotoSegment["motion"];
  readonly intensity: number;
  /** 0 at the segment's first frame, 1 at its last. */
  readonly progress: number;
};

/** Extra scale at full intensity for a zoom. 12% reads as movement, not drift. */
const ZOOM_RANGE = 0.12;
/** Headroom a pan needs to travel into without exposing an edge. */
const PAN_OVERSCAN = 0.14;
/** Fraction of the available slack a pan actually traverses. */
const PAN_TRAVEL = 0.8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Resolve a photo's framing.
 *
 * Pure, and deliberately so: this function is where most of the visible
 * quality of the finished film lives, it is the thing most likely to be
 * tweaked, and it is trivial to unit-test only for as long as it depends on
 * nothing but its arguments.
 *
 * Two invariants hold for every input, and are tested as properties rather
 * than as examples:
 *
 *   1. The drawn image always covers the composition — no letterboxing, ever.
 *   2. The drawn image never exposes an edge — the frame stays inside it.
 *
 * The focal point is honoured as far as those allow, and clamped otherwise. A
 * focal point near an edge therefore pulls the framing as far as it can go and
 * then stops, rather than sliding empty space into shot.
 */
export const framePhoto = (input: FramingInput): Frame => {
  const {
    sourceWidth,
    sourceHeight,
    outWidth,
    outHeight,
    focalPoint,
    motion,
    intensity,
    progress,
  } = input;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error(`invalid source dimensions ${sourceWidth}x${sourceHeight}`);
  }

  const t = clamp(progress, 0, 1);
  const strength = clamp(intensity, 0, 1);

  // 1. Cover the composition.
  const coverScale = Math.max(outWidth / sourceWidth, outHeight / sourceHeight);

  // 2. Motion scale on top of cover. Pans hold a constant overscan so there is
  //    somewhere to travel; zooms move between 1 and 1 + range.
  const zoom = ZOOM_RANGE * strength;
  const pan = PAN_OVERSCAN * strength;
  let motionScale: number;
  switch (motion) {
    case "in":
      motionScale = 1 + zoom * t;
      break;
    case "out":
      motionScale = 1 + zoom * (1 - t);
      break;
    case "panLeft":
    case "panRight":
      motionScale = 1 + pan;
      break;
    case "still":
      motionScale = 1;
      break;
  }

  const width = sourceWidth * coverScale * motionScale;
  const height = sourceHeight * coverScale * motionScale;

  // 3. Put the focal point under the centre of frame.
  let x = outWidth / 2 - focalPoint.x * width;
  let y = outHeight / 2 - focalPoint.y * height;

  // 4. Pan travels across the available horizontal slack.
  //    panRight moves the VIEW right, so the image slides left.
  //
  //    Travel is scaled by intensity, not just by the overscan it produces. A
  //    wide source has slack from the aspect mismatch alone, so without this a
  //    panLeft at intensity 0 still drifts — and intensity would not mean what
  //    it says. Zero intensity is zero movement, for every motion.
  if (motion === "panLeft" || motion === "panRight") {
    const slack = Math.max(0, width - outWidth);
    const travel = slack * PAN_TRAVEL * strength * (t - 0.5);
    x += motion === "panRight" ? -travel : travel;
  }

  // 5. Never expose an edge. min/max ordering matters: when the drawn image is
  //    exactly the frame size the bounds collapse to a single legal value.
  x = clamp(x, Math.min(0, outWidth - width), 0);
  y = clamp(y, Math.min(0, outHeight - height), 0);

  return { x, y, width, height };
};

/**
 * Framing for a moving-image segment: cover the composition from the centre,
 * then punch in.
 *
 * A 4:3 crop of 1920x1080 is 1440x1080 — exactly the output — so any scale
 * above 1.0 is upscaling. 6-10% is invisible in practice; 4K capture removes
 * the compromise. `upscaleRatio` reports how far past native this goes so QC
 * can warn rather than the renderer refuse.
 */
export const frameVideo = (input: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly outWidth: number;
  readonly outHeight: number;
  readonly scale: number;
}): Frame & { readonly upscaleRatio: number } => {
  const { sourceWidth, sourceHeight, outWidth, outHeight, scale } = input;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error(`invalid source dimensions ${sourceWidth}x${sourceHeight}`);
  }

  const coverScale = Math.max(outWidth / sourceWidth, outHeight / sourceHeight);
  const width = sourceWidth * coverScale * scale;
  const height = sourceHeight * coverScale * scale;

  return {
    x: (outWidth - width) / 2,
    y: (outHeight - height) / 2,
    width,
    height,
    // How many source pixels back one output pixel, expressed as a ratio > 1
    // when we are asking for more detail than the source holds.
    upscaleRatio: Math.max(1, (outWidth * scale) / sourceWidth, (outHeight * scale) / sourceHeight),
  };
};

/** CSS for an absolutely-positioned image or video drawn at `frame`. */
export const frameStyle = (frame: Frame): {
  position: "absolute";
  left: number;
  top: number;
  width: number;
  height: number;
} => ({
  position: "absolute",
  left: frame.x,
  top: frame.y,
  width: frame.width,
  height: frame.height,
});
