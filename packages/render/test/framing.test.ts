import { describe, expect, it } from "vitest";
import { framePhoto, frameVideo, type FramingInput } from "../src/framing/photoFraming.js";

const OUT = { outWidth: 1440, outHeight: 1080 };

/** Portrait, landscape, square, panoramic, and the exact-fit boundary. */
const SHAPES = [
  { name: "portrait", sourceWidth: 1200, sourceHeight: 1600 },
  { name: "landscape", sourceWidth: 3000, sourceHeight: 2000 },
  { name: "square", sourceWidth: 2400, sourceHeight: 2400 },
  { name: "panoramic", sourceWidth: 6000, sourceHeight: 1200 },
  { name: "tall panoramic", sourceWidth: 900, sourceHeight: 4000 },
  { name: "exact 4:3", sourceWidth: 1440, sourceHeight: 1080 },
  { name: "tiny", sourceWidth: 120, sourceHeight: 90 },
] as const;

const MOTIONS = ["in", "out", "panLeft", "panRight", "still"] as const;
const INTENSITIES = [0, 0.3, 0.5, 1];
const FOCAL_POINTS = [
  { x: 0.5, y: 0.5 },
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 0.15, y: 0.85 },
];
const PROGRESSES = [0, 0.25, 0.5, 0.75, 1];

const everyCombination = (): FramingInput[] => {
  const cases: FramingInput[] = [];
  for (const shape of SHAPES) {
    for (const motion of MOTIONS) {
      for (const intensity of INTENSITIES) {
        for (const focalPoint of FOCAL_POINTS) {
          for (const progress of PROGRESSES) {
            cases.push({
              sourceWidth: shape.sourceWidth,
              sourceHeight: shape.sourceHeight,
              ...OUT,
              focalPoint,
              motion,
              intensity,
              progress,
            });
          }
        }
      }
    }
  }
  return cases;
};

const describeCase = (c: FramingInput): string =>
  `${c.sourceWidth}x${c.sourceHeight} ${c.motion} i=${c.intensity} ` +
  `f=(${c.focalPoint.x},${c.focalPoint.y}) t=${c.progress}`;

describe("photo framing", () => {
  const cases = everyCombination();
  // Half a pixel of slack: these are floats, and a sub-pixel edge is not a
  // visible one.
  const EPSILON = 0.5;

  it(`covers the composition in all ${String(cases.length)} combinations`, () => {
    for (const c of cases) {
      const f = framePhoto(c);
      expect(f.width, describeCase(c)).toBeGreaterThanOrEqual(OUT.outWidth - EPSILON);
      expect(f.height, describeCase(c)).toBeGreaterThanOrEqual(OUT.outHeight - EPSILON);
    }
  });

  it("never exposes an edge in any combination", () => {
    for (const c of cases) {
      const f = framePhoto(c);
      expect(f.x, `left edge: ${describeCase(c)}`).toBeLessThanOrEqual(EPSILON);
      expect(f.y, `top edge: ${describeCase(c)}`).toBeLessThanOrEqual(EPSILON);
      expect(f.x + f.width, `right edge: ${describeCase(c)}`).toBeGreaterThanOrEqual(
        OUT.outWidth - EPSILON,
      );
      expect(f.y + f.height, `bottom edge: ${describeCase(c)}`).toBeGreaterThanOrEqual(
        OUT.outHeight - EPSILON,
      );
    }
  });

  it("preserves the source aspect ratio exactly", () => {
    for (const c of cases) {
      const f = framePhoto(c);
      expect(f.width / f.height, describeCase(c)).toBeCloseTo(
        c.sourceWidth / c.sourceHeight,
        6,
      );
    }
  });

  it("is deterministic — identical input gives an identical frame", () => {
    for (const c of cases.slice(0, 200)) {
      expect(framePhoto(c)).toEqual(framePhoto(c));
    }
  });

  it("holds a still photo perfectly still", () => {
    const base = {
      sourceWidth: 3000,
      sourceHeight: 2000,
      ...OUT,
      focalPoint: { x: 0.5, y: 0.5 },
      motion: "still",
      intensity: 1,
    } as const;
    const first = framePhoto({ ...base, progress: 0 });
    for (const progress of PROGRESSES) {
      expect(framePhoto({ ...base, progress })).toEqual(first);
    }
  });

  it("zooms in over time and out over time, symmetrically", () => {
    const base = {
      sourceWidth: 3000,
      sourceHeight: 2000,
      ...OUT,
      focalPoint: { x: 0.5, y: 0.5 },
      intensity: 1,
    } as const;
    const inStart = framePhoto({ ...base, motion: "in", progress: 0 });
    const inEnd = framePhoto({ ...base, motion: "in", progress: 1 });
    const outStart = framePhoto({ ...base, motion: "out", progress: 0 });
    const outEnd = framePhoto({ ...base, motion: "out", progress: 1 });

    expect(inEnd.width).toBeGreaterThan(inStart.width);
    expect(outEnd.width).toBeLessThan(outStart.width);
    // "out" is "in" run backwards.
    expect(inStart.width).toBeCloseTo(outEnd.width, 6);
    expect(inEnd.width).toBeCloseTo(outStart.width, 6);
  });

  it("zero intensity means no movement at all", () => {
    for (const motion of MOTIONS) {
      const base = {
        sourceWidth: 3000,
        sourceHeight: 2000,
        ...OUT,
        focalPoint: { x: 0.5, y: 0.5 },
        intensity: 0,
        motion,
      } as const;
      expect(framePhoto({ ...base, progress: 0 }), motion).toEqual(
        framePhoto({ ...base, progress: 1 }),
      );
    }
  });

  it("pans in opposite directions, and pans move horizontally only", () => {
    const base = {
      sourceWidth: 6000,
      sourceHeight: 1200,
      ...OUT,
      focalPoint: { x: 0.5, y: 0.5 },
      intensity: 1,
    } as const;
    const rightStart = framePhoto({ ...base, motion: "panRight", progress: 0 });
    const rightEnd = framePhoto({ ...base, motion: "panRight", progress: 1 });
    const leftStart = framePhoto({ ...base, motion: "panLeft", progress: 0 });
    const leftEnd = framePhoto({ ...base, motion: "panLeft", progress: 1 });

    // panRight moves the VIEW right, so the image slides left.
    expect(rightEnd.x).toBeLessThan(rightStart.x);
    expect(leftEnd.x).toBeGreaterThan(leftStart.x);
    expect(rightStart.y).toBeCloseTo(rightEnd.y, 6);
    expect(rightStart.width).toBeCloseTo(rightEnd.width, 6);
  });

  it("honours the focal point when there is room to", () => {
    // A panoramic source has horizontal slack, so a low focal x should place
    // the framing further left than a high one.
    const base = {
      sourceWidth: 6000,
      sourceHeight: 1200,
      ...OUT,
      motion: "still",
      intensity: 0,
      progress: 0,
    } as const;
    const left = framePhoto({ ...base, focalPoint: { x: 0.2, y: 0.5 } });
    const right = framePhoto({ ...base, focalPoint: { x: 0.8, y: 0.5 } });
    expect(left.x).toBeGreaterThan(right.x);
  });

  it("clamps rather than letting an edge-focal-point pull in empty space", () => {
    const base = {
      sourceWidth: 6000,
      sourceHeight: 1200,
      ...OUT,
      motion: "still",
      intensity: 0,
      progress: 0,
    } as const;
    const hardLeft = framePhoto({ ...base, focalPoint: { x: 0, y: 0 } });
    expect(hardLeft.x).toBeCloseTo(0, 6);
    const hardRight = framePhoto({ ...base, focalPoint: { x: 1, y: 1 } });
    expect(hardRight.x + hardRight.width).toBeCloseTo(OUT.outWidth, 6);
  });

  it("clamps out-of-range progress and intensity instead of extrapolating", () => {
    const base = {
      sourceWidth: 3000,
      sourceHeight: 2000,
      ...OUT,
      focalPoint: { x: 0.5, y: 0.5 },
      motion: "in",
      intensity: 1,
    } as const;
    expect(framePhoto({ ...base, progress: -5 })).toEqual(
      framePhoto({ ...base, progress: 0 }),
    );
    expect(framePhoto({ ...base, progress: 5 })).toEqual(
      framePhoto({ ...base, progress: 1 }),
    );
  });

  it("rejects impossible source dimensions rather than dividing by zero", () => {
    const base = {
      sourceWidth: 0,
      sourceHeight: 1000,
      ...OUT,
      focalPoint: { x: 0.5, y: 0.5 },
      motion: "still",
      intensity: 0,
      progress: 0,
    } as const;
    expect(() => framePhoto(base)).toThrow(/invalid source dimensions/);
  });
});

describe("video framing", () => {
  it("centre-crops 16:9 into 4:3 without letterboxing", () => {
    const f = frameVideo({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...OUT,
      scale: 1,
    });
    // Cover scale is driven by height here, so the frame keeps its 1080 and
    // loses width equally on both sides.
    expect(f.height).toBeCloseTo(1080, 6);
    expect(f.width).toBeCloseTo(1920, 6);
    expect(f.x).toBeCloseTo(-240, 6);
    expect(f.y).toBeCloseTo(0, 6);
  });

  it("covers the composition at every supported punch-in", () => {
    for (const scale of [1, 1.06, 1.1]) {
      const f = frameVideo({ sourceWidth: 1920, sourceHeight: 1080, ...OUT, scale });
      expect(f.width, `scale ${String(scale)}`).toBeGreaterThanOrEqual(OUT.outWidth);
      expect(f.height, `scale ${String(scale)}`).toBeGreaterThanOrEqual(OUT.outHeight);
      expect(f.x).toBeLessThanOrEqual(0);
      expect(f.y).toBeLessThanOrEqual(0);
    }
  });

  it("stays centred at every punch-in", () => {
    for (const scale of [1, 1.06, 1.1]) {
      const f = frameVideo({ sourceWidth: 1920, sourceHeight: 1080, ...OUT, scale });
      expect(f.x + f.width / 2, `scale ${String(scale)}`).toBeCloseTo(OUT.outWidth / 2, 6);
      expect(f.y + f.height / 2, `scale ${String(scale)}`).toBeCloseTo(OUT.outHeight / 2, 6);
    }
  });

  it("reports the upscale a punch-in costs on a 1080p source", () => {
    // A 4:3 crop of 1920x1080 is exactly 1440x1080, so 1.0 is native and any
    // punch-in above it is upscaling. This is the number that argues for 4K
    // capture; it must be visible rather than implicit.
    expect(frameVideo({ sourceWidth: 1920, sourceHeight: 1080, ...OUT, scale: 1 }).upscaleRatio)
      .toBeCloseTo(1, 6);
    expect(frameVideo({ sourceWidth: 1920, sourceHeight: 1080, ...OUT, scale: 1.1 }).upscaleRatio)
      .toBeCloseTo(1.1, 6);
    // A 4K source absorbs the same punch-in with detail to spare.
    expect(frameVideo({ sourceWidth: 3840, sourceHeight: 2160, ...OUT, scale: 1.1 }).upscaleRatio)
      .toBeCloseTo(1, 6);
  });
});
