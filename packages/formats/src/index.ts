/**
 * A format is a RENDER PARAMETER, not EDL data. Registering another one later
 * therefore requires no EDL migration — which is the whole reason it lives
 * here rather than in the document.
 */
export type Format = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly fps: number;
  readonly safeInset: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly titleMaxChars: number;
  readonly captionScale: number;
};

/**
 * The interview composition is 4:3 landscape and must not be cropped into
 * anything else. A later 16:9 or vertical format is an explicitly designed
 * adaptation, not a crop of this one.
 */
export const LANDSCAPE_CLASSIC: Format = {
  id: "landscape-classic",
  width: 1440,
  height: 1080,
  aspectRatio: "4:3",
  fps: 30,
  safeInset: { top: 0.06, right: 0.06, bottom: 0.08, left: 0.06 },
  titleMaxChars: 48,
  captionScale: 1,
};

export const FORMAT_REGISTRY = {
  "landscape-classic": LANDSCAPE_CLASSIC,
} as const satisfies Record<string, Format>;

export type FormatId = keyof typeof FORMAT_REGISTRY;

export const getFormat = (id: string): Format => {
  const f = (FORMAT_REGISTRY as Record<string, Format | undefined>)[id];
  if (f === undefined) {
    throw new Error(
      `unknown format "${id}"; registered: ${Object.keys(FORMAT_REGISTRY).join(", ")}`,
    );
  }
  return f;
};

/** Safe area in pixels for the given format. All geometry derives from this. */
export const safeArea = (f: Format): {
  x: number; y: number; width: number; height: number;
} => {
  const x = f.width * f.safeInset.left;
  const y = f.height * f.safeInset.top;
  return {
    x,
    y,
    width: f.width * (1 - f.safeInset.left - f.safeInset.right),
    height: f.height * (1 - f.safeInset.top - f.safeInset.bottom),
  };
};
