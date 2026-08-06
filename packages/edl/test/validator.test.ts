import { describe, expect, it } from "vitest";
import { validateEdl, type IssueCode, type ValidationContext } from "../src/index.js";
import {
  audio,
  baseContext,
  clone,
  codesOf,
  describeResult,
  prompt,
  prompts,
  speech,
  speeches,
  visual,
  visuals,
  VALID_EDL,
  type Rec,
} from "./helpers.js";

/** Assert the mutation produced the expected error and the EDL is rejected. */
const expectError = (
  edl: unknown,
  code: IssueCode,
  ctx: ValidationContext = baseContext(),
): void => {
  const result = validateEdl(edl, ctx);
  if (result.ok) {
    throw new Error(`expected ${code} but the EDL validated — ${describeResult(result)}`);
  }
  expect(codesOf(result.errors), describeResult(result)).toContain(code);
};

const expectValid = (edl: unknown, ctx: ValidationContext = baseContext()) => {
  const result = validateEdl(edl, ctx);
  if (!result.ok) {
    throw new Error(`expected valid but got ${describeResult(result)}`);
  }
  return result;
};

describe("the valid sample", () => {
  it("passes every invariant", () => {
    const result = expectValid(VALID_EDL);
    expect(result.edl.totalDurationMs).toBe(214_000);
    expect(result.edl.visualSegments).toHaveLength(34);
    expect(result.edl.promptSegments).toHaveLength(3);
    expect(result.edl.speechSegments).toHaveLength(11);
    expect(new Set(result.edl.promptSegments.map((p) => p.mode))).toEqual(
      new Set(["text-only", "recorded-interviewer", "live-interviewer"]),
    );
  });

  it("produces no warnings — every boundary is frame-aligned and in target", () => {
    expect(codesOf(expectValid(VALID_EDL).warnings)).toEqual([]);
  });

  it("exercises every visual kind, scale, motion, entry, transition and reveal", () => {
    const v = expectValid(VALID_EDL).edl.visualSegments;
    const pick = <T>(f: (s: (typeof v)[number]) => T | undefined) =>
      new Set(v.map(f).filter((x): x is T => x !== undefined));

    expect(pick((s) => s.kind)).toEqual(
      new Set(["title", "black", "interview", "photo", "broll"]),
    );
    expect(pick((s) => (s.kind === "interview" ? s.scale : undefined))).toEqual(
      new Set([1, 1.06, 1.1]),
    );
    expect(pick((s) => (s.kind === "photo" ? s.motion : undefined))).toEqual(
      new Set(["in", "out", "panLeft", "panRight", "still"]),
    );
    expect(pick((s) => (s.kind === "photo" ? s.entry : undefined))).toEqual(
      new Set(["cut", "insetExpand"]),
    );
    expect(pick((s) => s.transitionIn.type)).toEqual(
      new Set(["cut", "crossfade", "fade"]),
    );
    expect(pick((s) => (s.kind === "title" ? s.reveal : undefined))).toEqual(
      new Set(["sequential", "fade"]),
    );
  });
});

describe("schema", () => {
  it("rejects an unknown key", () => {
    const edl = clone();
    visual(edl, "v13_iv_greatest_a")["volume"] = 1;
    expectError(edl, "SCHEMA_INVALID");
  });

  it("rejects a non-integer millisecond", () => {
    const edl = clone();
    visual(edl, "v13_iv_greatest_a")["durationMs"] = 10_000.5;
    expectError(edl, "SCHEMA_INVALID");
  });

  it("rejects a cut carrying a duration", () => {
    const edl = clone();
    visual(edl, "v13_iv_greatest_a")["transitionIn"] = { type: "cut", durationMs: 400 };
    expectError(edl, "SCHEMA_INVALID");
  });

  it("rejects a crossfade of zero length", () => {
    const edl = clone();
    visual(edl, "v21_photo_early_b")["transitionIn"] = { type: "crossfade", durationMs: 0 };
    expectError(edl, "SCHEMA_INVALID");
  });

  it("rejects a punch-in scale outside 1.0 / 1.06 / 1.1", () => {
    const edl = clone();
    visual(edl, "v13_iv_greatest_a")["scale"] = 1.2;
    expectError(edl, "SCHEMA_INVALID");
  });

  it("rejects a focal point outside 0-1", () => {
    const edl = clone();
    visual(edl, "v12_photo_personality")["focalPoint"] = { x: 1.4, y: 0.5 };
    expectError(edl, "SCHEMA_INVALID");
  });

  it("makes audio unrepresentable on a text-only prompt", () => {
    const edl = clone();
    prompt(edl, "p01_love_text")["assetId"] = "asset_prompt_closing";
    expectError(edl, "SCHEMA_INVALID");
  });
});

describe("general", () => {
  it("rejects a duplicate segment id across tracks", () => {
    const edl = clone();
    speech(edl, "s05_longevity")["id"] = "v13_iv_greatest_a";
    expectError(edl, "DUPLICATE_SEGMENT_ID");
  });

  it("rejects a reference to an asset not in the manifest", () => {
    const edl = clone();
    visual(edl, "v13_iv_greatest_a")["assetId"] = "asset_does_not_exist";
    expectError(edl, "UNKNOWN_ASSET");
  });

  it("rejects an interview segment pointing at a photo", () => {
    const edl = clone();
    visual(edl, "v13_iv_greatest_a")["assetId"] = "asset_photo_group";
    expectError(edl, "ASSET_KIND_MISMATCH");
  });

  it("rejects a photo claiming a slot its asset does not fill", () => {
    const edl = clone();
    visual(edl, "v12_photo_personality")["slotId"] = "photo_group";
    expectError(edl, "ASSET_SLOT_MISMATCH");
  });

  it("rejects speech attributed to the wrong question", () => {
    const edl = clone();
    speech(edl, "s05_longevity")["questionId"] = "greatest_lesson";
    expectError(edl, "ASSET_QUESTION_MISMATCH");
  });

  it("rejects a separately recorded prompt pointing at an interview asset", () => {
    const edl = clone();
    prompt(edl, "p02_closing_recorded")["assetId"] = "asset_iv_closing_message";
    expectError(edl, "ASSET_KIND_MISMATCH");
  });

  it("rejects a prompt recording bound to the wrong question", () => {
    const edl = clone();
    prompt(edl, "p02_closing_recorded")["questionId"] = "love_lesson";
    expectError(edl, "ASSET_QUESTION_MISMATCH");
  });

  it("rejects an fps that disagrees with the active format", () => {
    expectError(VALID_EDL, "FPS_FORMAT_MISMATCH", baseContext({
      format: { id: "cinema", width: 1440, height: 1080, fps: 24 },
    }));
  });

  it("rejects an EDL validated against a different template", () => {
    const edl = clone();
    edl["templateId"] = "some-other-template";
    expectError(edl, "TEMPLATE_MISMATCH");
  });

  it("rejects a segment shorter than two frames", () => {
    const edl = clone();
    // 33ms is one frame at 30fps: it can round away to nothing.
    visual(edl, "v13_iv_greatest_a")["durationMs"] = 33;
    expectError(edl, "SEGMENT_TOO_SHORT");
  });

  it("warns when a boundary does not land on a frame", () => {
    const edl = clone();
    const a = visual(edl, "v13_iv_greatest_a");
    const b = visual(edl, "v14_broll_group_a");
    a["durationMs"] = 10_050;
    a["sourceOutMs"] = 33_850;
    b["startMs"] = 70_050;
    b["durationMs"] = 4_950;
    b["sourceOutMs"] = 5_950;
    const result = validateEdl(edl, baseContext());
    expect(result.ok).toBe(true);
    expect(codesOf(result.warnings)).toContain("TIME_NOT_FRAME_ALIGNED");
  });

  it("rejects a title carrying both its own text and overlay text", () => {
    const edl = clone();
    visual(edl, "v03_main_title")["overlayTextKey"] = "opening";
    expectError(edl, "OVERLAY_TEXT_COLLISION");
  });
});

describe("question-prompt timeline", () => {
  it("rejects overlapping prompts", () => {
    const edl = clone();
    prompt(edl, "p02_closing_recorded")["startMs"] = 140_000;
    expectError(edl, "PROMPT_OVERLAP");
  });

  it("rejects out-of-order prompts", () => {
    const edl = clone();
    const list = prompts(edl);
    const first = list[0];
    const second = list[1];
    if (first === undefined || second === undefined) throw new Error("sample too short");
    list[0] = second;
    list[1] = first;
    expectError(edl, "PROMPT_NOT_SORTED");
  });

  it("rejects a question that overlaps its answer", () => {
    const edl = clone();
    prompt(edl, "p01_love_text")["startMs"] = 140_500;
    expectError(edl, "PROMPT_SPEECH_OVERLAP");
  });

  it("enforces the template's minimum pause before an answer", () => {
    const edl = clone();
    prompt(edl, "p01_love_text")["durationMs"] = 1_100;
    const captions = prompt(edl, "p01_love_text")["captions"] as Rec[];
    const last = captions.at(-1);
    if (last === undefined) throw new Error("no captions");
    last["endMs"] = 1_000;
    expectError(
      edl,
      "PROMPT_ANSWER_GAP_TOO_SHORT",
      baseContext({
        conformance: { ...baseContext().conformance, minPromptAnswerGapMs: 400 },
      }),
    );
  });

  it("rejects a prompt outside the film", () => {
    const edl = clone();
    prompt(edl, "p03_bonus_live")["startMs"] = 213_000;
    expectError(edl, "PROMPT_OUTSIDE_TIMELINE");
  });

  it("rejects a prompt with no later answer", () => {
    const edl = clone();
    prompt(edl, "p03_bonus_live")["startMs"] = 208_000;
    expectError(edl, "PROMPT_ANSWER_MISSING");
  });

  it("rejects a recorded prompt whose source span disagrees with its duration", () => {
    const edl = clone();
    prompt(edl, "p02_closing_recorded")["sourceOutMs"] = 2_900;
    expectError(edl, "SOURCE_SPAN_MISMATCH");
  });

  it("rejects prompt text timed past the prompt boundary", () => {
    const edl = clone();
    const captions = prompt(edl, "p01_love_text")["captions"] as Rec[];
    const last = captions.at(-1);
    if (last === undefined) throw new Error("no captions");
    last["endMs"] = 1_300;
    expectError(edl, "CAPTION_OUT_OF_BOUNDS");
  });
});

describe("visual timeline", () => {
  it("rejects a transition on the first segment", () => {
    const edl = clone();
    const [first, second] = visuals(edl);
    if (first === undefined || second === undefined) throw new Error("sample too short");
    first["transitionIn"] = { type: "fade", durationMs: 800 };
    expectError(edl, "VISUAL_FIRST_HAS_TRANSITION");
  });

  it("rejects a gap between segments", () => {
    const edl = clone();
    // Shorten a segment without moving its successor: leaves 500ms of nothing.
    const a = visual(edl, "v13_iv_greatest_a");
    a["durationMs"] = 9_500;
    a["sourceOutMs"] = 33_300;
    expectError(edl, "VISUAL_CONTIGUITY_BROKEN");
  });

  it("rejects an undeclared overlap", () => {
    const edl = clone();
    const a = visual(edl, "v13_iv_greatest_a");
    a["durationMs"] = 10_500;
    a["sourceOutMs"] = 34_300;
    expectError(edl, "VISUAL_CONTIGUITY_BROKEN");
  });

  it("rejects a transition longer than the shorter adjacent segment", () => {
    const edl = clone();
    // v22 is 4600ms; ask for a 5000ms crossfade into it and shift it to match.
    const b = visual(edl, "v22_photo_personality_b");
    b["transitionIn"] = { type: "crossfade", durationMs: 5_000 };
    b["startMs"] = 121_400 + 5_000 - 5_000;
    expectError(edl, "VISUAL_TRANSITION_TOO_LONG");
  });

  it("accepts a transition exactly as long as the shorter neighbour", () => {
    const edl = clone();
    const a = visual(edl, "v28_photo_keepsake");
    const b = visual(edl, "v29_photo_group_b");
    // Both are 4600ms; a 4600ms crossfade is the boundary case, not an error.
    b["transitionIn"] = { type: "crossfade", durationMs: 4_600 };
    b["startMs"] = 181_400 + 4_600 - 4_600;
    b["durationMs"] = 4_600;
    void a;
    const result = validateEdl(edl, baseContext());
    expect(codesOf(result.ok ? [] : result.errors)).not.toContain(
      "VISUAL_TRANSITION_TOO_LONG",
    );
  });

  it("rejects a visual track that does not end at totalDurationMs", () => {
    const edl = clone();
    edl["totalDurationMs"] = 214_100;
    expectError(edl, "VISUAL_DOES_NOT_END_AT_TOTAL");
  });

  it("rejects a source span that disagrees with the segment duration", () => {
    const edl = clone();
    visual(edl, "v13_iv_greatest_a")["sourceOutMs"] = 34_000;
    expectError(edl, "SOURCE_SPAN_MISMATCH");
  });

  it("rejects reading past the end of the source asset", () => {
    const edl = clone();
    const a = visual(edl, "v13_iv_greatest_a");
    a["sourceInMs"] = 85_000;
    a["sourceOutMs"] = 95_000; // asset is 90000ms
    expectError(edl, "SOURCE_RANGE_OUTSIDE_ASSET");
  });

  it("rejects a punch-in the template does not offer", () => {
    expectError(VALID_EDL, "INTERVIEW_SCALE_UNSUPPORTED", baseContext({
      conformance: { ...baseContext().conformance, interviewScales: [1] },
    }));
  });
});

describe("speech timeline", () => {
  it("rejects overlapping speech", () => {
    const edl = clone();
    speech(edl, "s06_greatest_lesson")["startMs"] = 54_000; // s05 runs to 54800
    expectError(edl, "SPEECH_OVERLAP");
  });

  it("rejects out-of-order speech", () => {
    const edl = clone();
    const list = speeches(edl);
    const a = list[4];
    const b = list[5];
    if (a === undefined || b === undefined) throw new Error("sample too short");
    list[4] = b;
    list[5] = a;
    expectError(edl, "SPEECH_NOT_SORTED");
  });

  it("allows silence between speech segments", () => {
    // The sample already has gaps; assert that is deliberate, not tolerated.
    const result = expectValid(VALID_EDL);
    const segs = result.edl.speechSegments;
    const gaps = segs.slice(1).map((s, i) => {
      const prev = segs[i];
      if (prev === undefined) throw new Error("unreachable");
      return s.startMs - (prev.startMs + prev.durationMs);
    });
    expect(gaps.every((g) => g >= 0)).toBe(true);
    expect(gaps.some((g) => g > 0)).toBe(true);
  });

  it("rejects speech running past the end of the film", () => {
    const edl = clone();
    const s = speech(edl, "s11_bonus");
    s["durationMs"] = 20_000;
    s["sourceOutMs"] = 23_000;
    expectError(edl, "SPEECH_OUTSIDE_TIMELINE");
  });

  it("rejects a caption ending past its segment", () => {
    const edl = clone();
    const s = speech(edl, "s02_identity_name");
    const captions = s["captions"] as Rec[];
    const lastCaption = captions[captions.length - 1];
    if (lastCaption === undefined) throw new Error("no captions");
    lastCaption["endMs"] = 4_000; // segment is 3800ms
    expectError(edl, "CAPTION_OUT_OF_BOUNDS");
  });

  it("rejects overlapping caption words", () => {
    const edl = clone();
    const captions = speech(edl, "s02_identity_name")["captions"] as Rec[];
    const second = captions[1];
    if (second === undefined) throw new Error("no second caption");
    second["startMs"] = 100; // first word ends at 690
    expectError(edl, "CAPTION_NOT_SORTED");
  });

  it("accepts a caption ending exactly at the segment boundary", () => {
    const edl = clone();
    const s = speech(edl, "s02_identity_name");
    const captions = s["captions"] as Rec[];
    const lastCaption = captions[captions.length - 1];
    if (lastCaption === undefined) throw new Error("no captions");
    lastCaption["endMs"] = 3_800; // exactly durationMs
    expectValid(edl);
  });

  it("rejects an emphasis range past the last word", () => {
    const edl = clone();
    speech(edl, "s06_greatest_lesson")["emphasis"] = {
      startWord: 7,
      endWord: 400,
      tone: "meaningful",
    };
    expectError(edl, "EMPHASIS_OUT_OF_RANGE");
  });
});

describe("cross-track invariants", () => {
  it("rejects a talking head out of sync with its own voice", () => {
    const edl = clone();
    const v = visual(edl, "v13_iv_greatest_a");
    v["sourceInMs"] = 24_000; // 200ms adrift of the speech track
    v["sourceOutMs"] = 34_000;
    expectError(edl, "LIP_SYNC_DRIFT");
  });

  it("accepts drift of exactly one frame", () => {
    const edl = clone();
    const v = visual(edl, "v13_iv_greatest_a");
    v["sourceInMs"] = 23_800 + 33;
    v["sourceOutMs"] = 33_800 + 33;
    const result = validateEdl(edl, baseContext());
    expect(codesOf(result.ok ? [] : result.errors)).not.toContain("LIP_SYNC_DRIFT");
  });

  it("rejects drift of one frame plus one millisecond", () => {
    const edl = clone();
    const v = visual(edl, "v13_iv_greatest_a");
    v["sourceInMs"] = 23_800 + 34;
    v["sourceOutMs"] = 33_800 + 34;
    expectError(edl, "LIP_SYNC_DRIFT");
  });

  it("rejects one person's voice under another person's face", () => {
    const edl = clone();
    // Put the longevity clip on screen while the greatest-lesson answer plays.
    const v = visual(edl, "v13_iv_greatest_a");
    v["assetId"] = "asset_iv_longevity";
    expectError(edl, "SPEAKER_COLLISION");
  });

  it("allows speech to continue beneath photos and b-roll", () => {
    // s06 starts under a photo (v12) and continues under b-roll (v14).
    const result = expectValid(VALID_EDL);
    const s6 = result.edl.speechSegments.find((s) => s.id === "s06_greatest_lesson");
    const v12 = result.edl.visualSegments.find((s) => s.id === "v12_photo_personality");
    expect(s6).toBeDefined();
    expect(v12).toBeDefined();
    expect(s6!.startMs).toBeGreaterThanOrEqual(v12!.startMs);
    expect(s6!.startMs).toBeLessThan(v12!.startMs + v12!.durationMs);
  });
});

describe("music", () => {
  it("rejects a track id that resolves to nothing", () => {
    const edl = clone();
    audio(edl)["musicTrackId"] = "not-in-the-registry";
    expectError(edl, "MUSIC_TRACK_UNRESOLVED");
  });

  it("rejects placeholder music outside fixture contexts", () => {
    expectError(VALID_EDL, "MUSIC_TRACK_UNLICENSED", baseContext({
      allowPlaceholderMusic: false,
    }));
  });

  it("rejects an unlicensed track even where placeholders are allowed", () => {
    expectError(VALID_EDL, "MUSIC_TRACK_UNLICENSED", baseContext({
      allowPlaceholderMusic: true,
      resolveMusicTrack: () => ({
        id: "placeholder-tone-bed",
        durationMs: 240_000,
        beatGridMs: Array.from({ length: 75 }, (_, i) => i * 3200),
        cues: {
          openingMs: 0,
          titleMs: 9_000,
          lifts: [56_000, 80_000, 141_000],
          resolutionMs: 169_000,
          endingMs: 192_000,
        },
        licenseRef: null,
        usage: "licensed",
        available: false,
      }),
    }));
  });

  it("rejects a track shorter than the film", () => {
    const edl = clone();
    audio(edl)["musicStartMs"] = 30_000; // 30000 + 214000 > 240000
    expectError(edl, "MUSIC_TRACK_TOO_SHORT");
  });

  it("rejects a cue sheet pointing outside the track", () => {
    expectError(VALID_EDL, "MUSIC_CUE_OUTSIDE_TRACK", baseContext({
      resolveMusicTrack: () => ({
        id: "placeholder-tone-bed",
        durationMs: 240_000,
        beatGridMs: Array.from({ length: 75 }, (_, i) => i * 3200),
        cues: {
          openingMs: 0,
          titleMs: 9_000,
          lifts: [56_000, 80_000, 141_000],
          resolutionMs: 169_000,
          endingMs: 999_000,
        },
        licenseRef: "ok",
        usage: "licensed",
        available: true,
      }),
    }));
  });

  it("rejects a beat grid that no longer matches the registry", () => {
    const edl = clone();
    const grid = audio(edl)["beatGridMs"] as number[];
    grid[10] = 32_100; // registry has 32000
    expectError(edl, "BEAT_GRID_DIVERGENCE");
  });

  it("rejects a beat grid that is not ascending", () => {
    const edl = clone();
    const grid = audio(edl)["beatGridMs"] as number[];
    grid[10] = 0;
    expectError(edl, "BEAT_GRID_DIVERGENCE");
  });
});

describe("template conformance", () => {
  it("rejects a third emphasis moment", () => {
    const edl = clone();
    speech(edl, "s07_advice")["emphasis"] = {
      startWord: 0,
      endWord: 5,
      tone: "surprising",
    };
    expectError(edl, "TOO_MANY_EMPHASIS");
  });

  it("accepts exactly two", () => {
    const result = expectValid(VALID_EDL);
    expect(result.edl.speechSegments.filter((s) => s.emphasis !== undefined)).toHaveLength(2);
  });

  it("rejects three photos in a row", () => {
    const edl = clone();
    // v23 sits between two photo pairs; turn it into a third consecutive photo.
    const v = visual(edl, "v23_iv_group_b");
    delete v["sourceInMs"];
    delete v["sourceOutMs"];
    delete v["scale"];
    v["kind"] = "photo";
    v["assetId"] = "asset_photo_group";
    v["slotId"] = "photo_group";
    v["focalPoint"] = { x: 0.5, y: 0.5 };
    v["motion"] = "still";
    v["intensity"] = 0;
    v["entry"] = "cut";
    expectError(edl, "TOO_MANY_CONSECUTIVE_PHOTOS");
  });

  it("rejects a film missing a required slot", () => {
    expectError(VALID_EDL, "REQUIRED_SLOT_MISSING", baseContext({
      conformance: {
        ...baseContext().conformance,
        requiredPhotoSlotIds: ["photo_early", "photo_personality", "photo_group", "photo_wedding"],
      },
    }));
  });

  it("rejects speech attributed to a question the template does not ask", () => {
    const edl = clone();
    const s = speech(edl, "s05_longevity");
    s["questionId"] = "what_is_your_favourite_colour";
    // Also repoint the asset so the failure is the unknown question, not the mismatch.
    const result = validateEdl(edl, baseContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.errors)).toContain("UNKNOWN_QUESTION_ID");
  });

  it("warns when the film falls outside the target duration", () => {
    const result = validateEdl(VALID_EDL, baseContext({
      conformance: {
        ...baseContext().conformance,
        targetDurationMs: { min: 300_000, max: 400_000 },
      },
    }));
    expect(result.ok).toBe(true);
    expect(codesOf(result.warnings)).toContain("DURATION_OUTSIDE_TARGET");
  });
});
