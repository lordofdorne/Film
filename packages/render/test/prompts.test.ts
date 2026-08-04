import { EdlSchema } from "@film/edl";
import { describe, expect, it } from "vitest";
import sampleEdl from "../../../sample/life-advice.edl.json" with { type: "json" };
import { promptWindows, spokenIntervals } from "../src/timing/windows.js";

const EDL = EdlSchema.parse(sampleEdl);

describe("question prompts", () => {
  it("creates one render window for each supported mode", () => {
    const windows = promptWindows(EDL);
    expect(windows).toHaveLength(3);
    expect(new Set(windows.map((w) => w.segment.mode))).toEqual(
      new Set(["text-only", "recorded-interviewer", "live-interviewer"]),
    );
    expect(windows.every((w) => w.durationInFrames > 0)).toBe(true);
  });

  it("ducks music for recorded questions but not text-only questions", () => {
    const intervals = spokenIntervals(EDL);
    expect(intervals).toContainEqual([166_000, 169_000]);
    expect(intervals).toContainEqual([197_200, 198_300]);
    expect(intervals).not.toContainEqual([139_800, 141_000]);
  });

  it("keeps spoken intervals in timeline order", () => {
    const starts = spokenIntervals(EDL).map(([start]) => start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
