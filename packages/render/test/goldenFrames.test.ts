import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";

import { webpackOverride } from "../../../scripts/webpack-override.js";

/**
 * GOLDEN FRAMES ARE PROVISIONAL.
 *
 * They were generated against synthetic placeholder media on macOS/arm64. When
 * real fixture media arrives — or when this first runs on a different OS or
 * Chrome build — REGENERATE AND REVIEW them rather than treating the diff as a
 * regression. Video frame extraction and font rasterisation are not
 * bit-identical across platforms, and pretending otherwise produces a suite
 * that everyone learns to ignore.
 *
 *   UPDATE_GOLDENS=1 pnpm vitest run goldenFrames
 *
 * What these DO protect: that a change to layout, timing, framing, transitions
 * or text treatment was intentional. That is worth having even when the
 * absolute pixels are machine-specific.
 */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const GOLDEN_DIR = fileURLToPath(new URL("./golden", import.meta.url));
const ACTUAL_DIR = join(ROOT, "out", "golden-actual");
const DIFF_DIR = join(ROOT, "out", "golden-diff");

const UPDATE = process.env["UPDATE_GOLDENS"] === "1";

/** Fraction of pixels allowed to differ before a frame is called a regression. */
const MAX_DIFF_RATIO = 0.005;
/** Per-pixel colour sensitivity, 0 (strict) to 1 (loose). */
const PIXEL_THRESHOLD = 0.12;

/**
 * One frame per treatment the template can produce. Frame numbers are derived
 * from the sample EDL: see sample/life-advice.edl.json.
 */
const FRAMES: ReadonlyArray<{ name: string; frame: number; why: string }> = [
  { name: "01-opening-overlay", frame: 60, why: "b-roll under overlay title text, safe area" },
  { name: "02-cold-open-crossfade", frame: 108, why: "b-roll -> interview crossfade, mid-dissolve" },
  { name: "03-title-reveal-partial", frame: 285, why: "sequential word reveal, part way through" },
  { name: "04-title-reveal-complete", frame: 400, why: "title fully revealed" },
  { name: "05-photo-inset-expand", frame: 683, why: "portrait photo, insetExpand entry, first frames" },
  { name: "06-photo-settled-lowres", frame: 770, why: "low-res portrait settled, Ken Burns in" },
  { name: "07-interview-punchin-106", frame: 1200, why: "interview at scale 1.06" },
  { name: "08-broll-under-speech", frame: 1400, why: "b-roll with interview speech continuing" },
  { name: "09-photo-over-speech", frame: 1700, why: "landscape photo panRight, caption over image" },
  { name: "10-emphasis-meaningful", frame: 1830, why: "emphasis caption, meaningful tone" },
  { name: "11-interview-punchin-11", frame: 2300, why: "interview at scale 1.1" },
  { name: "12-photo-out-motion", frame: 2450, why: "square photo, out motion, insetExpand" },
  { name: "13-crossfade-interview-photo", frame: 3651, why: "600ms dissolve, both layers visible" },
  { name: "14-crossfade-photo-photo", frame: 3777, why: "photo-to-photo dissolve" },
  { name: "15-emphasis-funny", frame: 4470, why: "emphasis caption, funny tone, two lines" },
  { name: "16-keepsake-still", frame: 5460, why: "keepsake, still motion, insetExpand" },
  { name: "17-black-card", frame: 5700, why: "black beat card" },
  { name: "18-end-title", frame: 5850, why: "end title callback" },
  { name: "19-bonus-fade", frame: 5930, why: "title -> interview fade, incoming over black" },
  { name: "20-dedication", frame: 6270, why: "dedication card, fade reveal" },
];

const readPng = (path: string): PNG => PNG.sync.read(readFileSync(path));

describe("golden frames", () => {
  let serveUrl: string;
  let composition: Awaited<ReturnType<typeof selectComposition>>;

  beforeAll(async () => {
    // Fixtures must exist; generating them here would make one test take a
    // minute and hide the dependency.
    const probe = join(ROOT, "fixtures", "interview", "asset_iv_greatest_lesson.mp4");
    if (!existsSync(probe)) {
      execFileSync("pnpm", ["fixtures"], { cwd: ROOT, stdio: "inherit" });
    }
    for (const dir of [GOLDEN_DIR, ACTUAL_DIR, DIFF_DIR]) {
      mkdirSync(dir, { recursive: true });
    }

    serveUrl = await bundle({
      entryPoint: join(ROOT, "packages/render/src/entry.ts"),
      publicDir: join(ROOT, "fixtures"),
      webpackOverride,
    });
    composition = await selectComposition({ serveUrl, id: "LifeAdvice" });
  }, 600_000);

  it("covers every visual kind, transition and text treatment", () => {
    // A guard on the list itself: if a treatment is added and no frame is
    // captured for it, this is where it should be noticed.
    expect(FRAMES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(FRAMES.map((f) => f.name)).size).toBe(FRAMES.length);
    expect(new Set(FRAMES.map((f) => f.frame)).size).toBe(FRAMES.length);
  });

  for (const { name, frame, why } of FRAMES) {
    it(`${name} — ${why}`, async () => {
      const goldenPath = join(GOLDEN_DIR, `${name}.png`);
      const actualPath = join(ACTUAL_DIR, `${name}.png`);

      await renderStill({
        serveUrl,
        composition,
        frame,
        output: actualPath,
        overwrite: true,
        chromiumOptions: { gl: "swiftshader" },
        offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024,
        timeoutInMilliseconds: 120_000,
      });

      if (UPDATE || !existsSync(goldenPath)) {
        mkdirSync(dirname(goldenPath), { recursive: true });
        writeFileSync(goldenPath, readFileSync(actualPath));
        // Not a silent pass: an absent golden is recorded, never asserted on.
        expect(existsSync(goldenPath)).toBe(true);
        return;
      }

      const expectedPng = readPng(goldenPath);
      const actualPng = readPng(actualPath);

      expect(
        { width: actualPng.width, height: actualPng.height },
        "frame dimensions changed",
      ).toEqual({ width: expectedPng.width, height: expectedPng.height });

      const diff = new PNG({ width: expectedPng.width, height: expectedPng.height });
      const differing = pixelmatch(
        expectedPng.data,
        actualPng.data,
        diff.data,
        expectedPng.width,
        expectedPng.height,
        { threshold: PIXEL_THRESHOLD },
      );
      const ratio = differing / (expectedPng.width * expectedPng.height);

      if (ratio > MAX_DIFF_RATIO) {
        writeFileSync(join(DIFF_DIR, `${name}.png`), PNG.sync.write(diff));
      }

      expect(
        ratio,
        `${(ratio * 100).toFixed(3)}% of pixels differ (limit ${(MAX_DIFF_RATIO * 100).toFixed(
          1,
        )}%). If this change was intended, review out/golden-diff/${name}.png then ` +
          "re-run with UPDATE_GOLDENS=1.",
      ).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    }, 180_000);
  }
});
