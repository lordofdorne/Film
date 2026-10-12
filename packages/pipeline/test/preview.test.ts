import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makePreview } from "../src/media/preview.js";

const run = promisify(execFile);
let dir = "";

/** What the normalised file is like: 1080p, 30 fps, keyframes ten seconds apart, with sound. */
const NORMALISED = (): string => join(dir, "normalised.mp4");

const probe = async (file: string, entries: string, extra: string[] = []): Promise<string> =>
  (await run("ffprobe", ["-v", "error", ...extra, "-show_entries", entries, "-of", "csv=p=0", file])).stdout.trim();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "preview-"));
  await run("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "300", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", NORMALISED(),
  ]);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("makePreview", () => {
  it("keeps every frame at the same time, so the edit plays in step", async () => {
    const out = join(dir, "preview.mp4");
    await makePreview(NORMALISED(), out, "interview");
    const frames = async (f: string) => probe(f, "stream=nb_frames", ["-select_streams", "v"]);
    expect(await frames(out)).toBe(await frames(NORMALISED()));
    const duration = async (f: string) => Number(await probe(f, "format=duration"));
    expect(Math.abs((await duration(out)) - (await duration(NORMALISED())))).toBeLessThan(0.05);
    // And it still has sound: the speech track plays from the same file.
    expect(await probe(out, "stream=codec_type", ["-select_streams", "a"])).toBe("audio");
  });

  it("is 720p with a keyframe every second, where the source had one in ten", async () => {
    const out = join(dir, "preview.mp4");
    expect(await probe(out, "stream=height", ["-select_streams", "v"])).toBe("720");
    const keyframes = (await probe(out, "frame=pts_time", ["-select_streams", "v", "-skip_frame", "nokey"]))
      .split("\n")
      .map((line) => Number.parseFloat(line))
      .filter((t) => Number.isFinite(t));
    expect(keyframes.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < keyframes.length; i++) {
      expect((keyframes[i] ?? 0) - (keyframes[i - 1] ?? 0)).toBeCloseTo(1, 1);
    }
  });

  it("is smaller than the file it was made from", async () => {
    expect((await stat(join(dir, "preview.mp4"))).size).toBeLessThan((await stat(NORMALISED())).size);
  });
});
