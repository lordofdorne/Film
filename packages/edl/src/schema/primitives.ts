import { z } from "zod";

/**
 * Every time and duration in an EDL is an integer number of milliseconds.
 * Floats are rejected outright rather than rounded: a fractional millisecond
 * that survives into the renderer becomes a fractional frame, and a fractional
 * frame is a rounding decision made silently in three different places.
 */
export const MsInt = z.number().int().nonnegative();
export const MsPositive = z.number().int().positive();

/** Normalised 0–1 coordinate or scalar (focal points, intensity). */
export const Unit = z.number().min(0).max(1);

/**
 * Stable identifiers. Deliberately excludes "/" and whitespace so an id can
 * never be mistaken for, or interpolated into, a storage key or URL path.
 */
export const Id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-:.]+$/, {
  message: "must contain only letters, digits, and _ - : .",
});

/** A key into the active template's text map. Never a literal string. */
export const TextKey = z.string().min(1).max(64);

/** Frames per second is fixed for phase 1; see FORMAT_REGISTRY. */
export const FPS = 30;

/** Milliseconds per frame at 30fps, as an exact rational: 100/3. */
export const msPerFrame = (fps: number): number => 1000 / fps;

/**
 * A boundary lands exactly on a frame iff ms * fps / 1000 is an integer.
 * At 30fps that means ms must be a multiple of 100.
 */
export const isFrameAligned = (ms: number, fps: number): boolean =>
  Number.isInteger((ms * fps) / 1000);

/** Frame index containing the given timeline position. */
export const msToFrame = (ms: number, fps: number): number =>
  Math.round((ms * fps) / 1000);

export const frameToMs = (frame: number, fps: number): number =>
  (frame * 1000) / fps;
