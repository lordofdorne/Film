import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { photoNormaliseArgs } from "../src/stages/ingest.js";

const run = promisify(execFile);

/**
 * The photograph that has two photographs in it.
 *
 * Phones write multi-picture JPEGs: the image, plus an HDR gain map or a
 * thumbnail, indexed by an APP2 MPF segment. ffmpeg decodes both, and the
 * image2 muxer refuses to write two frames to one filename — so ingest
 * failed, so compose never ran, so a finished film said "putting your film
 * together" for ever. Every fixture in this repository is single-frame, which
 * is exactly why nothing caught it until a real phone was pointed at a real
 * photograph.
 *
 * **The two-picture case is not covered by a fixture here, and that is worth
 * knowing rather than glossing.** A genuine MPO needs the MPF segment, which
 * cannot be synthesised by concatenating JPEGs — tried, and ffmpeg reads one
 * frame from the result. Committing a real one is not an option either: this
 * repository is public and holds no binary media. So the guard below is on
 * the FLAGS, which is what somebody tidying the argument list would remove,
 * and the real behaviour was verified against an actual iPhone photograph
 * (5568×4176, `nb_read_frames = 2`) that failed before this change and
 * succeeded after it.
 */
let dir = "";
let available = false;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "photo-ingest-"));
  try {
    await run("ffmpeg", ["-version"]);
    available = true;
  } catch {
    process.stderr.write("ffmpeg unavailable — skipping photo ingest test\n");
  }
}, 30_000);

afterAll(async () => {
  if (dir !== "") await rm(dir, { recursive: true, force: true });
});

describe("normalising a photograph", () => {
  it("asks ffmpeg for exactly one picture out of the file", () => {
    const args = photoNormaliseArgs("in.jpg", "out.jpg");
    // Both, and adjacent to their values: -frames:v 1 stops after the first
    // picture, -update 1 tells the muxer one filename is the intent. Removing
    // either brings the failure back.
    expect(args.join(" ")).toContain("-frames:v 1");
    expect(args.join(" ")).toContain("-update 1");
  });

  it("normalises an ordinary photograph to a single frame", async () => {
    if (!available) throw new Error("ffmpeg is not installed");

    const source = join(dir, "plain.jpg");
    await run("ffmpeg", [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=teal:s=641x481",
      "-frames:v", "1",
      source,
    ]);

    const output = join(dir, "normalised.jpg");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...photoNormaliseArgs(source, output)]);

    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-count_frames",
      "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames,width,height",
      "-of", "default=nw=1:nk=1",
      output,
    ]);
    const [width, height, frames] = stdout.trim().split("\n").map(Number);

    expect(frames).toBe(1);
    // The odd dimensions above are deliberate: the scale filter exists to make
    // them even, and h264 refuses odd ones later.
    expect(width).toBe(640);
    expect(height).toBe(480);
  }, 60_000);
});
