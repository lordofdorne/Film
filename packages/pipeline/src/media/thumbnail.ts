import { ffmpeg, probe, type RunOptions } from "./ffmpeg.js";

/**
 * A small picture of a piece of media, for a card in a list.
 *
 * This exists because the hub was drawing its cards from the customer's
 * originals: a 7 MB photograph rendered 56 pixels wide, and a whole interview
 * take opened as a <video> to show one frame. 105 MB across one real film, and
 * none of it cached, because a fresh signature every render changes the src.
 *
 * So: one small JPEG per asset, made once, drawn everywhere a list needs a
 * picture.
 */

/**
 * Long edge, in pixels.
 *
 * The card draws it at 56 CSS pixels. 320 is roughly three times that, which
 * covers a 3× phone screen exactly, and leaves room for the card to grow
 * without this having to be regenerated. A 320-pixel JPEG at q:v 5 lands
 * around 15–30 KB — under a thousandth of the photograph it came from.
 */
export const THUMBNAIL_LONG_EDGE = 320;

/**
 * Where in a take the frame comes from.
 *
 * Not frame zero. Cameras open on a dark or half-exposed frame, phones more so,
 * and a wall of black squares is a worse hub than no pictures at all. A second
 * in, the exposure has settled and the subject is usually still sitting there
 * about to speak.
 */
export const THUMBNAIL_SEEK_SECONDS = 1;

/**
 * The arguments, as a list, so a test can run exactly what the stage runs.
 *
 * `-ss` goes BEFORE `-i`, which makes it an input seek: ffmpeg jumps to the
 * keyframe near that point instead of decoding a minute of video to throw it
 * away. On a five-minute take that is the difference between a thumbnail
 * costing milliseconds and costing seconds.
 *
 * `scale=...:force_original_aspect_ratio=decrease` fits the long edge without
 * distorting anything, and `-frames:v 1 -update 1` is the same pair ingest
 * needs for photographs: a multi-picture JPEG off a phone decodes to two
 * frames, and the image2 muxer refuses to write two frames to one filename.
 */
export const thumbnailArgs = (
  source: string,
  output: string,
  options: { readonly seekSeconds?: number; readonly longEdge?: number } = {},
): string[] => {
  const edge = String(options.longEdge ?? THUMBNAIL_LONG_EDGE);
  const seek = options.seekSeconds ?? 0;
  return [
    ...(seek > 0 ? ["-ss", String(seek)] : []),
    "-i", source,
    "-vf", `scale=${edge}:${edge}:force_original_aspect_ratio=decrease`,
    "-frames:v", "1",
    "-update", "1",
    "-q:v", "5",
    output,
  ];
};

/**
 * Make one, from a photograph or from a take.
 *
 * A take is seeked into; a still is not, and asking for a second into a
 * single-frame image gets you no frames at all. Beyond that they are the same
 * command, which is why there is one function rather than two.
 *
 * A take SHORTER than the seek point is the case that bites: ffmpeg seeks past
 * the end, writes nothing, and exits zero — a success with no file. So a take
 * that produces nothing is retried from the first frame rather than reported
 * as a thumbnail that exists.
 */
export const makeThumbnail = async (
  source: string,
  output: string,
  kind: "photo" | "video" | "interview",
  options: RunOptions & { readonly longEdge?: number } = {},
): Promise<void> => {
  const longEdge = options.longEdge ?? THUMBNAIL_LONG_EDGE;
  if (kind === "photo") {
    await ffmpeg(thumbnailArgs(source, output, { longEdge }), options);
    return;
  }

  await ffmpeg(
    thumbnailArgs(source, output, { seekSeconds: THUMBNAIL_SEEK_SECONDS, longEdge }),
    options,
  );
  if (await hasImage(output, options)) return;

  // Shorter than the seek point, or seeked into a gap. Take the first frame.
  await ffmpeg(thumbnailArgs(source, output, { longEdge }), options);
};

/** Whether ffmpeg actually left a decodable image behind. */
const hasImage = async (path: string, options?: RunOptions): Promise<boolean> => {
  try {
    return (await probe(path, options)).width > 0;
  } catch {
    return false;
  }
};
