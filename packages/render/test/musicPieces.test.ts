import { describe, expect, it } from "vitest";

import { crossfadeGainAt, musicPiecesOf } from "../src/audio/musicPieces.js";

describe("musicPiecesOf", () => {
  it("is the whole track from its start when there are no edits, as it always was", () => {
    expect(musicPiecesOf({ musicStartMs: 0 }, 214_000)).toEqual([
      { fromMs: 0, toMs: 214_000, trackFromMs: 0, fadeInMs: 0, fadeOutMs: 0 },
    ]);
  });

  it("splits at an edit, overlapping the two pieces for its crossfade", () => {
    const [before, after] = musicPiecesOf(
      { musicStartMs: 0, musicEdits: [{ atMs: 96_000, toMs: 108_800, crossfadeMs: 400 }] },
      214_000,
    );
    expect(before).toEqual({ fromMs: 0, toMs: 96_200, trackFromMs: 0, fadeInMs: 0, fadeOutMs: 400 });
    // The incoming piece starts half a crossfade early, half a crossfade into
    // the track before the rejoin point, so the rejoin downbeat lands on 96 s.
    expect(after).toEqual({ fromMs: 95_800, toMs: 214_000, trackFromMs: 108_600, fadeInMs: 400, fadeOutMs: 0 });
  });
});

describe("crossfadeGainAt", () => {
  const [before, after] = musicPiecesOf(
    { musicStartMs: 0, musicEdits: [{ atMs: 96_000, toMs: 108_800, crossfadeMs: 400 }] },
    214_000,
  );

  it("is full away from the edit", () => {
    if (before === undefined || after === undefined) throw new Error("pieces");
    expect(crossfadeGainAt(before, 50_000)).toBe(1);
    expect(crossfadeGainAt(after, 150_000)).toBe(1);
  });

  it("hands over with equal power: no dip in loudness at the edit itself", () => {
    if (before === undefined || after === undefined) throw new Error("pieces");
    const out = crossfadeGainAt(before, 96_000);
    const into = crossfadeGainAt(after, 96_000);
    expect(out * out + into * into).toBeCloseTo(1, 5);
  });
});
