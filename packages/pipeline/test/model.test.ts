import { describe, expect, it } from "vitest";

import {
  AssetSelectionSchema,
  buildManifest,
  filmAssets,
  MUSIC_BED_SLOT,
  parseProjectConfig,
  type AssetRow,
} from "../src/model.js";

const row = (over: Partial<AssetRow>): AssetRow =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-0000000000ff",
    questionId: null,
    slotId: null,
    kind: "interview",
    sha256: null,
    storageKey: "projects/p/original/a/source.mov",
    normalisedKey: "projects/p/normalised/a/normalised.mp4",
    contentType: null,
    byteSize: null,
    etag: null,
    captureMethod: null,
    qcMetrics: null,
    warnings: null,
    transcriptKey: null,
    selection: null,
    aiProvenance: null,
    createdAt: new Date(),
    ...over,
  }) as AssetRow;

describe("buildManifest", () => {
  it("describes each kind of asset from what ingest measured", () => {
    const manifest = buildManifest([
      row({
        id: "a1",
        kind: "interview",
        questionId: "greatest_lesson",
        qcMetrics: { width: 1280, height: 720, durationMs: 12_000 },
      }),
      row({ id: "a2", kind: "photo", slotId: "keepsake", qcMetrics: { width: 900, height: 1200 } }),
      row({
        id: "a3",
        kind: "video",
        slotId: "video_group",
        qcMetrics: { width: 1920, height: 1080, durationMs: 6_000 },
      }),
    ]);

    expect(manifest.assets).toHaveLength(3);
    expect(manifest.assets[0]).toEqual({
      id: "a1",
      kind: "interview",
      questionId: "greatest_lesson",
      durationMs: 12_000,
      width: 1280,
      height: 720,
    });
  });

  /**
   * The bed has a storage key and measured metadata like any other asset, but
   * no segment points at it — the picture reaches it through the EDL's music
   * track id. The audio entry schema requires a questionId for exactly that
   * reason, so including it would not even parse.
   */
  it("leaves the music bed out of the manifest", () => {
    const bed = row({
      id: "bed",
      kind: "audio",
      slotId: MUSIC_BED_SLOT,
      qcMetrics: { durationMs: 200_000 },
    });
    const take = row({
      id: "a1",
      kind: "interview",
      questionId: "longevity",
      qcMetrics: { width: 1280, height: 720, durationMs: 9_000 },
    });

    expect(filmAssets([bed, take]).map((r) => r.id)).toEqual(["a1"]);
    expect(buildManifest([bed, take]).assets.map((a) => a.id)).toEqual(["a1"]);
  });

  /**
   * Refusing beats defaulting. A film composed against dimensions nobody
   * measured would frame every shot wrongly and still validate, and the
   * dispatcher is not supposed to reach compose before ingest has finished —
   * so this is a bug in us, and it should read like one.
   */
  it("refuses an asset that has not been ingested rather than guessing a size", () => {
    expect(() => buildManifest([row({ id: "a1", questionId: "q", qcMetrics: null })])).toThrow(
      /has not been ingested/,
    );
  });
});

describe("project config", () => {
  it("defaults to no prompt cards and no music", () => {
    expect(parseProjectConfig(null)).toEqual({ questionPrompts: [] });
  });

  it("refuses an unknown key rather than ignoring it", () => {
    expect(() => parseProjectConfig({ questionPrompts: [], musicTrack: "x" })).toThrow();
  });
});

describe("answer selection", () => {
  it("requires the spoken words, since they are the caption text", () => {
    expect(AssetSelectionSchema.safeParse({}).success).toBe(false);
    expect(AssetSelectionSchema.safeParse({ spoken: "hello" }).success).toBe(true);
  });

  it("accepts a cold open and one emphasis moment", () => {
    const parsed = AssetSelectionSchema.parse({
      spoken: "be kinder than you think you need to be",
      coldOpen: "be kinder",
      emphasis: { phrase: "kinder", tone: "meaningful" },
    });
    expect(parsed.emphasis?.tone).toBe("meaningful");
  });
});
