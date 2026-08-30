import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeThumbnail,
  thumbnailArgs,
  THUMBNAIL_LONG_EDGE,
} from "../src/media/thumbnail.js";
import { hasPicture, needsThumbnail, thumbnailKeyOf } from "../src/stages/thumbnail.js";
import type { AssetRow } from "../src/model.js";

const run = promisify(execFile);

/**
 * The picture a list can afford to draw.
 *
 * The hub drew its cards from the customer's originals — a 7 MB photograph at
 * 56 pixels wide, a whole interview take opened as a <video> — which measured
 * 105 MB across one real film, re-fetched on every visit. These tests are about
 * the two things that make the replacement worth having: it is small, and it
 * is not black.
 */
let dir = "";
let available = false;

const ffmpeg = async (args: readonly string[]): Promise<void> => {
  await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args]);
};

const dimensions = async (path: string): Promise<{ width: number; height: number }> => {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "default=nw=1:nk=1",
    path,
  ]);
  const [width = 0, height = 0] = stdout.trim().split("\n").map(Number);
  return { width, height };
};

/** How bright the picture is, 0–255. A cold-open frame reads near zero. */
const meanLuma = async (path: string): Promise<number> => {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostdin",
    "-i", path,
    "-vf", "signalstats,metadata=print",
    "-f", "null", "-",
  ]);
  const match = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(stderr);
  return match?.[1] === undefined ? Number.NaN : Number(match[1]);
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "thumbnail-"));
  try {
    await run("ffmpeg", ["-version"]);
    available = true;
  } catch {
    process.stderr.write("ffmpeg unavailable — skipping thumbnail tests\n");
  }
}, 30_000);

afterAll(async () => {
  if (dir !== "") await rm(dir, { recursive: true, force: true });
});

describe("thumbnailArgs", () => {
  /**
   * The flag order that is not cosmetic. `-ss` before `-i` is an input seek:
   * ffmpeg jumps to a keyframe near that point. After `-i` it decodes
   * everything up to there and throws it away, which on a five-minute answer
   * turns a millisecond into seconds — per card, on a page with twenty of them.
   */
  it("seeks before the input, not after it", () => {
    const args = thumbnailArgs("take.mp4", "thumb.jpg", { seekSeconds: 1 });
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
  });

  it("does not seek at all when it was not asked to", () => {
    expect(thumbnailArgs("photo.jpg", "thumb.jpg")).not.toContain("-ss");
  });

  /**
   * The same pair ingest needs for photographs. A phone writes multi-picture
   * JPEGs, ffmpeg decodes both, and the image2 muxer refuses two frames for one
   * filename — so a thumbnail of a real photograph fails without these, which
   * is precisely the file this is most often pointed at.
   */
  it("asks for exactly one picture out of the file", () => {
    const args = thumbnailArgs("in.jpg", "out.jpg").join(" ");
    expect(args).toContain("-frames:v 1");
    expect(args).toContain("-update 1");
  });
});

describe("hasPicture", () => {
  const asset = (over: Partial<AssetRow>): AssetRow =>
    ({ id: "a", projectId: "p", kind: "photo", slotId: null, ...over }) as AssetRow;

  it("is true for everything with a frame in it", () => {
    expect(hasPicture(asset({ kind: "photo" }))).toBe(true);
    expect(hasPicture(asset({ kind: "video" }))).toBe(true);
    expect(hasPicture(asset({ kind: "interview" }))).toBe(true);
  });

  /**
   * Sound has no frame, and asking ffmpeg for one fails. Without this the music
   * bed and the interviewer's recorded questions would each put a permanent
   * failure on a film that is perfectly fine.
   */
  it("is false for the music bed and for recorded questions", () => {
    expect(hasPicture(asset({ kind: "audio", slotId: "music_bed" }))).toBe(false);
    expect(hasPicture(asset({ kind: "audio", slotId: null }))).toBe(false);
  });
});

/**
 * The predicate the dispatcher, the backfill and the stage all have to agree
 * on.
 *
 * They did not. The stage compared keys — so it was willing to replace an
 * older recipe's picture — while the dispatcher only checked the column for
 * null, and so never asked. Bumping the recipe would have re-dispatched the
 * work, skipped it, and left the old picture in place under a row saying it
 * succeeded. Found by looking at real rows after a re-run, not by reading it.
 */
describe("needsThumbnail", () => {
  const PROJECT = "44444444-4444-4444-4444-444444444444";
  const ASSET = "55555555-5555-5555-5555-555555555555";
  const asset = (thumbnailKey: string | null): AssetRow =>
    ({
      id: ASSET,
      projectId: PROJECT,
      kind: "interview",
      slotId: null,
      thumbnailKey,
    }) as AssetRow;

  it("wants one when there is none", () => {
    expect(needsThumbnail(asset(null))).toBe(true);
  });

  it("is satisfied by this recipe's own thumbnail", () => {
    expect(needsThumbnail(asset(thumbnailKeyOf(PROJECT, ASSET)))).toBe(false);
  });

  /** The whole point of putting the version in the name. */
  it("wants a new one when the recipe has moved on", () => {
    const superseded = thumbnailKeyOf(PROJECT, ASSET).replace(/thumb-v\d+/, "thumb-v0");
    expect(needsThumbnail(asset(superseded))).toBe(true);
  });

  it("never wants one for something with no picture in it", () => {
    const bed = { ...asset(null), kind: "audio", slotId: "music_bed" } as AssetRow;
    expect(needsThumbnail(bed)).toBe(false);
  });
});

describe("making one", () => {
  it("turns a large photograph into something a card can afford", async () => {
    if (!available) throw new Error("ffmpeg is not installed");

    // The shape of a real phone photograph: big, and not square.
    const source = join(dir, "big.jpg");
    await ffmpeg([
      "-f", "lavfi", "-i", "testsrc=size=4032x3024",
      "-frames:v", "1", "-q:v", "2",
      source,
    ]);

    const output = join(dir, "photo-thumb.jpg");
    await makeThumbnail(source, output, "photo");

    const { width, height } = await dimensions(output);
    expect(width).toBe(THUMBNAIL_LONG_EDGE);
    // 4:3 in, 4:3 out. force_original_aspect_ratio=decrease is what keeps
    // somebody's face the shape it was.
    expect(height).toBe(240);

    /**
     * The number the whole exercise is for.
     *
     * The three photographs on the film that prompted this were 7.3, 4.2 and
     * 6.7 MB, each drawn at 56 pixels. Anything in tens of kilobytes is the
     * win; the ceiling here is loose on purpose, because the point is the order
     * of magnitude and not this particular test pattern's entropy.
     */
    const { size } = await stat(output);
    expect(size).toBeLessThan(100_000);
    expect(size).toBeGreaterThan(500);
  }, 60_000);

  /**
   * Not frame zero, and this is the difference between a hub and a wall of
   * black squares. Cameras open dark and phones more so; a second in, the
   * exposure has settled.
   */
  it("skips the first moment of a take, where the camera is still dark", async () => {
    if (!available) throw new Error("ffmpeg is not installed");

    // Black for the first second, then bright — a camera finding its exposure.
    const source = join(dir, "dark-open.mp4");
    await ffmpeg([
      "-f", "lavfi", "-i", "color=c=black:s=640x480:d=1",
      "-f", "lavfi", "-i", "color=c=white:s=640x480:d=4",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map", "[v]",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-g", "10",
      source,
    ]);

    const output = join(dir, "take-thumb.jpg");
    await makeThumbnail(source, output, "interview");

    expect(await meanLuma(output)).toBeGreaterThan(128);
  }, 120_000);

  /**
   * The failure that looks like a success.
   *
   * ffmpeg seeking past the end of a file writes nothing and exits ZERO. A
   * four-second answer is common and a two-second one happens; without the
   * retry from the first frame, those cards get a row saying the thumbnail
   * succeeded and no object behind it.
   */
  it("still gets a frame out of a take shorter than the seek point", async () => {
    if (!available) throw new Error("ffmpeg is not installed");

    const source = join(dir, "brief.mp4");
    await ffmpeg([
      "-f", "lavfi", "-i", "color=c=orange:s=640x480:d=0.4",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      source,
    ]);

    const output = join(dir, "brief-thumb.jpg");
    await makeThumbnail(source, output, "interview");

    const { width } = await dimensions(output);
    expect(width).toBeGreaterThan(0);
  }, 120_000);
});
