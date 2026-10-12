import { ffmpeg, type RunOptions } from "./ffmpeg.js";

/**
 * The copy the preview plays: light enough to stream on a phone, with a
 * keyframe every second so a cut into the middle of it starts at once.
 *
 * The preview was streaming the normalised file — 1080p at CRF 20, with
 * x264's default keyframe spacing of up to ten seconds — and every interview
 * twice, once for picture and once for sound. Each cut into a take meant
 * fetching from the nearest keyframe and decoding up to ten seconds of video
 * before the first frame, while the film was meant to be playing. That is the
 * stutter.
 *
 * The render never uses this. Picture quality in the delivered film is
 * decided by the normalised file and nothing here touches it.
 *
 * Timing is the normalised file's, frame for frame: no trim, no change of
 * frame rate, so every source time in the EDL means the same thing in both.
 */

/** Height of the preview picture. The player is never shown bigger than this
 *  on a phone, and seldom on a laptop. */
export const PREVIEW_HEIGHT = 720;
/** A keyframe a second at 30 fps: a seek is at most a second of decoding. */
const KEYFRAME_FRAMES = 30;

export const previewVideoArgs = (source: string, output: string): string[] => [
  "-i", source,
  // Down to 720 high, never up; width follows, kept even for x264.
  "-vf", `scale=-2:'min(${String(PREVIEW_HEIGHT)},ih)'`,
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
  "-maxrate", "2000k", "-bufsize", "4000k",
  "-g", String(KEYFRAME_FRAMES), "-keyint_min", String(KEYFRAME_FRAMES), "-sc_threshold", "0",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "96k", "-ac", "2",
  "-movflags", "+faststart",
  output,
];

/** Photographs, fitted to 1600 px on the long edge. */
export const PREVIEW_PHOTO_LONG_EDGE = 1600;

export const previewPhotoArgs = (source: string, output: string): string[] => [
  "-i", source,
  "-vf", `scale=${String(PREVIEW_PHOTO_LONG_EDGE)}:${String(PREVIEW_PHOTO_LONG_EDGE)}:force_original_aspect_ratio=decrease`,
  "-frames:v", "1",
  "-update", "1",
  "-q:v", "3",
  output,
];

export const makePreview = async (
  source: string,
  output: string,
  kind: "photo" | "video" | "interview",
  options?: RunOptions,
): Promise<void> => {
  await ffmpeg(kind === "photo" ? previewPhotoArgs(source, output) : previewVideoArgs(source, output), options);
};
