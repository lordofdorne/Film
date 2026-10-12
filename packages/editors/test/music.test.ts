import { describe, expect, it } from "vitest";

import { trackTimeAt, type EDL } from "@film/edl";
import { PLACEHOLDER_TRACK } from "@film/music";
import { getTemplate } from "@film/templates";

import { editorFor, type ComposeInput } from "../src/index.js";
import { fitMusic } from "../src/music.js";
import { talk } from "./talk.js";
import { validate } from "./validate.js";

/**
 * The fixture track has what a commissioned one will: a measured bar every
 * 3.2 s, and its cues marked — the title at 9 s, the resolution at 169 s, the
 * ending at 192 s, 240 s in all.
 */
const TRACK = {
  id: PLACEHOLDER_TRACK.id,
  durationMs: PLACEHOLDER_TRACK.durationMs,
  beatGridMs: PLACEHOLDER_TRACK.beatGridMs,
  cues: PLACEHOLDER_TRACK.cues,
};
const TRACK_INFO = {
  ...TRACK,
  licenseRef: PLACEHOLDER_TRACK.licenseRef,
  usage: PLACEHOLDER_TRACK.usage,
  available: PLACEHOLDER_TRACK.available,
};
const BAR = 3_200;

/** The same recording with its ending marked earlier, at 150 s: a track
 *  shorter than a full film, which has to repeat a section to reach it. */
const EARLY_END = { ...TRACK, cues: { ...TRACK.cues, resolutionMs: 128_000, endingMs: 150_400 } };

const template = getTemplate("life-advice", 1);

const filmOf = (sentences: number, track: ComposeInput["track"] = TRACK): ComposeInput => {
  const answers = template.questions.map((q) => {
    const t = talk(sentences);
    return { questionId: q.id, assetId: `asset-${q.id}`, durationMs: t.durationMs, runs: t.runs, spoken: t.text, words: t.words };
  });
  const clips = ["video_personality", "video_group", "video_environment"];
  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    template,
    answers,
    stills: ["photo_early", "photo_personality", "photo_group", "keepsake"].map((slotId) => ({ assetId: `still-${slotId}`, slotId })),
    brollAssetIds: Object.fromEntries(clips.map((s) => [s, `broll-${s}`])),
    assetDurationMs: {
      ...Object.fromEntries(answers.map((a) => [a.assetId, a.durationMs] as const)),
      ...Object.fromEntries(clips.map((s) => [`broll-${s}`, 40_000] as const)),
    },
    track,
    promptQuestionIds: [],
  };
};

const endTitleAt = (edl: EDL): number => edl.visualSegments.find((v) => v.id === "v_end_title")?.startMs ?? -1;

describe("the music ends with the film", () => {
  it.each([
    ["a short film, which skips", 2, TRACK],
    ["a long film on a track that ends early, which repeats", 20, EARLY_END],
  ] as const)("%s: the ending cue lands on the end title", (_name, sentences, track) => {
    const input = filmOf(sentences, track);
    const { edl, notes } = editorFor(template).edit(input);

    const result = validate({ ...input, template }, edl, { ...TRACK_INFO, cues: track.cues });
    if (!result.ok) throw new Error(JSON.stringify(result.errors.slice(0, 3)));

    // Within a frame: the edit is on a downbeat and the hold took the rest.
    expect(Math.abs(trackTimeAt(edl.audio, endTitleAt(edl)) - track.cues.endingMs)).toBeLessThanOrEqual(34);
    expect(notes.some((n) => n.includes("ends with the film"))).toBe(true);
  });

  it("skips forward for a short film and goes back for a long one", () => {
    const short = editorFor(template).edit(filmOf(2)).edl.audio.musicEdits?.[0];
    const long = editorFor(template).edit(filmOf(20, EARLY_END)).edl.audio.musicEdits?.[0];
    expect(short !== undefined && short.toMs > short.atMs).toBe(true);
    expect(long !== undefined && long.toMs < long.atMs).toBe(true);
  });

  it("leaves a temp bed — no beat grid, no ending — playing straight through", () => {
    const { edl } = editorFor(template).edit(
      filmOf(2, { id: "temp-end-of-august", beatGridMs: [], durationMs: 400_000, cues: { titleMs: 9_000 } }),
    );
    expect(edl.audio.musicEdits).toBeUndefined();
    expect(edl.visualSegments.find((v) => v.id === "v_black_beat")?.durationMs).toBe(2_400);
  });
});

describe("fitMusic", () => {
  it("needs no edit when the hold alone can make up the difference", () => {
    const fit = fitMusic(TRACK, TRACK.cues.endingMs - 1_000, 210_000, { shortenBy: 1_200, lengthenBy: 1_600 });
    expect(fit.edits).toEqual([]);
    expect(fit.holdAdjustMs).toBe(1_000);
  });

  it("edits only from a downbeat to a downbeat", () => {
    const fit = fitMusic(TRACK, 120_000, 150_000, { shortenBy: 1_200, lengthenBy: 1_600 });
    const edit = fit.edits[0];
    expect(edit).toBeDefined();
    expect((edit?.atMs ?? 1) % BAR).toBe(0);
    expect((edit?.toMs ?? 1) % BAR).toBe(0);
    expect(Math.abs(fit.holdAdjustMs)).toBeLessThanOrEqual(BAR / 2);
  });
});
