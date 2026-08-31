import { describe, expect, it } from "vitest";

import { validateEdl } from "@film/edl";
import { getFormat } from "@film/formats";
import { getTemplate, toConformance } from "@film/templates";

import { composeFilm, type ComposeInput } from "../src/compose/plan.js";

/**
 * Optional in the template must mean optional in the film.
 *
 * The hub marks a slot optional and lets somebody press "Make my film"
 * without it. Compose then called `still("keepsake")`, threw, and failed the
 * project permanently — a film killed hours later by a card the customer had
 * been told they could skip, with nothing connecting the two.
 *
 * `captureReadiness` is meant to be the single source for both progress and
 * the gate. This is the other half of that promise: what compose insists on
 * cannot be more than what capture asked for.
 */
const template = getTemplate("life-advice", 1);

/**
 * Every media slot the template does not insist on, from all three lists.
 *
 * `optionalSlots` is not the whole answer — `videoSlots` holds
 * `video_environment` with `required: false`, and reading only the obviously
 * named list would have missed exactly the second bug this file exists for.
 */
const optionalSlotIds = [
  ...template.optionalSlots,
  ...template.photoSlots.filter((s) => !s.required),
  ...template.videoSlots.filter((s) => !s.required),
].map((s) => s.id);

/**
 * Read from the template, not typed out here.
 *
 * The first version of this listed the questions by hand, invented one that
 * does not exist and missed one that does — so every case failed on
 * "no ingested answer for longevity" rather than on anything it meant to
 * test. The template is the source; a test that keeps its own copy is testing
 * the copy.
 */
const QUESTION_IDS = template.questions.map((q) => q.id);

/**
 * An answer with PAUSES in it, which is what a person recorded actually looks
 * like.
 *
 * One long unbroken run seemed simpler and quietly broke the fixture: the cold
 * open takes the first run of "greatest_lesson", so with only one run that
 * answer was skipped for "no speech detected" and every beat hanging off it —
 * including the one this file exists to test — never ran. The test passed by
 * not reaching the code.
 */
const answer = (questionId: string, durationMs = 30_000) => {
  const usable = durationMs - 1_000;
  const third = Math.floor(usable / 3);
  return {
    questionId,
    assetId: `asset-${questionId}`,
    durationMs,
    runs: [
      { startMs: 500, endMs: 500 + third },
      { startMs: 900 + third, endMs: 900 + third * 2 },
      { startMs: 1_300 + third * 2, endMs: usable },
    ],
    spoken: "a sentence with a reasonable number of words in it for captions to sit on",
  };
};

const inputWith = (
  skip: readonly string[],
  brollDurationMs = 40_000,
  answerDurationMs = 30_000,
): ComposeInput => {
  const mediaSlots = ["photo_early", "photo_personality", "photo_group", "keepsake"];
  const brollSlots = ["video_personality", "video_group", "video_environment"];

  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    template,
    answers: QUESTION_IDS.map((q) => answer(q, answerDurationMs)),
    stills: mediaSlots
      .filter((slotId) => !skip.includes(slotId))
      .map((slotId) => ({ assetId: `still-${slotId}`, slotId })),
    brollAssetIds: Object.fromEntries(
      brollSlots.filter((s) => !skip.includes(s)).map((s) => [s, `broll-${s}`]),
    ),
    assetDurationMs: {
      ...Object.fromEntries(QUESTION_IDS.map((q) => [`asset-${q}`, 40_000] as const)),
      ...Object.fromEntries(brollSlots.map((s) => [`broll-${s}`, brollDurationMs] as const)),
    },
    track: {
      id: "temp",
      beatGridMs: Array.from({ length: 200 }, (_, i) => i * 2000),
      cues: { titleMs: 12_000 },
    },
    promptQuestionIds: [],
  };
};

/**
 * The question, on screen, so you can tell what is being asked.
 *
 * Watching a finished film you could not. The prompt machinery existed — three
 * modes in the schema, a planner branch, a renderer, three golden frames — and
 * had never fired for a customer, because `promptQuestionIds` came from a
 * project config that browser capture created as an empty list, and an empty
 * list correctly means "no card for any question". Every EDL ever composed had
 * `promptSegments: []` and nothing looked wrong.
 */
describe("the question on screen", () => {
  const asked = (input: ComposeInput) =>
    composeFilm(input).edl.visualSegments.filter(
      (s) => "textStyle" in s && s.textStyle === "question",
    );

  const withCards = (ids: readonly string[]): ComposeInput => ({
    ...inputWith([]),
    promptQuestionIds: ids,
  });

  it("puts a card before each question it was given", () => {
    const cards = asked(withCards(["greatest_lesson", "love_lesson"]));
    expect(cards.map((s) => ("textKey" in s ? s.textKey : undefined))).toEqual([
      "question:greatest_lesson",
      "question:love_lesson",
    ]);
  });

  /**
   * A KEY, never the words. The schema's rule for visual segments, and the
   * reason the card can carry a question whose wording depends on the subject:
   * "What is the secret to living past 100?" is a different string for a
   * centenarian, and compose does not know or need to know.
   */
  it("names the question rather than carrying its text", () => {
    const [card] = asked(withCards(["greatest_lesson"]));
    const text = JSON.stringify(card);
    expect(text).toContain("question:greatest_lesson");
    expect(text).not.toContain("What is the greatest lesson");
  });

  it("is a card on black, in the question treatment", () => {
    const [card] = asked(withCards(["greatest_lesson"]));
    expect(card?.kind).toBe("black");
    expect(card && "textStyle" in card ? card.textStyle : undefined).toBe("question");
  });

  /** Long enough to read, and a longer question gets longer. */
  it("holds a longer question for longer, within the template's range", () => {
    const short = asked(withCards(["love_lesson"]))[0];
    const long = asked(withCards(["closing_message"]))[0];
    const { min, max } = template.questionPrompt.cardMs;
    for (const c of [short, long]) {
      expect(c?.durationMs).toBeGreaterThanOrEqual(min);
      expect(c?.durationMs).toBeLessThanOrEqual(max);
    }
    // "What have you learned about love?" against "What would you like to say
    // to whoever watches this?"
    expect(long?.durationMs).toBeGreaterThan(short?.durationMs ?? 0);
  });

  it("adds nothing at all when it is asked for nothing", () => {
    expect(asked(withCards([]))).toEqual([]);
  });

  /** The cards lengthen the film, which was the accepted cost of seeing them. */
  it("makes the film longer by roughly the cards it added", () => {
    const without = composeFilm(withCards([])).edl.totalDurationMs;
    const cards = asked(withCards(["greatest_lesson", "love_lesson"]));
    const with2 = composeFilm(withCards(["greatest_lesson", "love_lesson"])).edl.totalDurationMs;
    const added = cards.reduce((t, c) => t + c.durationMs, 0);
    // Transitions overlap, so the film grows by a little less than the sum.
    expect(with2 - without).toBeGreaterThan(added * 0.5);
    expect(with2 - without).toBeLessThanOrEqual(added);
  });
});

/**
 * The keepsake somebody FILMED rather than photographed.
 *
 * The template declares `accepts: ["photo", "video"]` for this slot and the
 * step sheet duly offers "Take a video". Compose sorts a video into
 * `brollAssetIds` and the closing sequence looked only in `stills` — so the
 * object was silently absent from the finished film. Green tick on the card,
 * clean ingest, an EDL that validated without one warning. Nothing anywhere
 * said the thing they filmed had been dropped.
 */
describe("a keepsake filmed rather than photographed", () => {
  /** The same film, with the keepsake supplied as a clip instead of a still. */
  const filmed = (clipMs = 12_000): ComposeInput => {
    const base = inputWith(["keepsake"]);
    return {
      ...base,
      brollAssetIds: { ...base.brollAssetIds, keepsake: "clip-keepsake" },
      assetDurationMs: { ...base.assetDurationMs, "clip-keepsake": clipMs },
    };
  };

  it("is a slot that really does accept both, or this test proves nothing", () => {
    const slot = template.optionalSlots.find((s) => s.id === "keepsake");
    expect(slot?.accepts).toEqual(expect.arrayContaining(["photo", "video"]));
  });

  it("puts the filmed object in the film", () => {
    const { edl } = composeFilm(filmed());
    const keepsake = edl.visualSegments.find((s) => "slotId" in s && s.slotId === "keepsake");
    expect(keepsake).toBeDefined();
    expect(keepsake?.kind).toBe("broll");
  });

  /** The ending keeps its shape: the clip sits where the photograph would. */
  it("closes on it and then the group photograph, in that order", () => {
    const { edl } = composeFilm(filmed());
    const slots = edl.visualSegments.map((s) => ("slotId" in s ? s.slotId : undefined));
    // Present FIRST. Without this the ordering assertion passes on -1, which
    // is exactly the broken behaviour this file exists to catch.
    expect(slots).toContain("keepsake");
    expect(slots.indexOf("keepsake")).toBeLessThan(slots.lastIndexOf("photo_group"));
  });

  it("never asks for more of the clip than there is", () => {
    const { edl } = composeFilm(filmed(3_000));
    const keepsake = edl.visualSegments.find((s) => "slotId" in s && s.slotId === "keepsake");
    expect((keepsake as { sourceOutMs?: number } | undefined)?.sourceOutMs).toBeLessThanOrEqual(
      3_000,
    );
  });

  /**
   * Too brief to be a shot: skipped like any other, and said out loud TWICE —
   * once by the beat that could not use it, once by the guard that notices
   * anything supplied and unused. "keepsake" alone would pass on the
   * unrelated "no keepsake was added" note, which is how a vacuous test looks.
   */
  it("skips a clip too short to hold a beat, and says so", () => {
    const { edl, notes } = composeFilm(filmed(400));
    const slots = edl.visualSegments.map((s) => ("slotId" in s ? s.slotId : undefined));
    expect(slots).not.toContain("keepsake");
    expect(notes.join(" ")).toContain("too short");
    expect(notes.join(" ")).toContain("does not appear in the film");
  });

  it("still composes a whole film either way", () => {
    expect(composeFilm(filmed()).edl.visualSegments.length).toBeGreaterThan(0);
    expect(composeFilm(inputWith([])).edl.visualSegments.length).toBeGreaterThan(0);
  });

  /**
   * And the EDL it produces PASSES THE VALIDATOR.
   *
   * Composing a segment is not the same as producing a film. The validator is
   * what stands between compose and the renderer, and a "fix" that turns a
   * silently missing beat into a project that fails validation two stages
   * later has moved the failure rather than fixed it — which is precisely the
   * shape of the last three real-media bugs in this pipeline.
   */
  it("produces an EDL the validator accepts", () => {
    const input = filmed();
    const { edl } = composeFilm(input);

    const manifest = {
      assets: [
        ...input.answers.map((a) => ({
          id: a.assetId,
          kind: "interview" as const,
          questionId: a.questionId,
          durationMs: input.assetDurationMs[a.assetId] ?? 40_000,
          width: 1920,
          height: 1080,
        })),
        ...input.stills.map((s) => ({
          id: s.assetId,
          kind: "photo" as const,
          slotId: s.slotId,
          width: 1920,
          height: 1080,
        })),
        ...Object.entries(input.brollAssetIds).map(([slotId, assetId]) => ({
          id: assetId,
          kind: "video" as const,
          slotId,
          durationMs: input.assetDurationMs[assetId] ?? 40_000,
          width: 1920,
          height: 1080,
        })),
      ],
    };

    const result = validateEdl(edl, {
      manifest,
      format: getFormat(template.defaultFormatId),
      conformance: toConformance(template),
      // A whole cue sheet, not just the one cue compose reads. The validator
      // checks every cue lands inside the track.
      resolveMusicTrack: () => ({
        id: "temp",
        durationMs: 400_000,
        beatGridMs: input.track.beatGridMs,
        cues: {
          openingMs: 0,
          titleMs: input.track.cues.titleMs,
          lifts: [60_000, 120_000, 180_000],
          resolutionMs: 240_000,
          endingMs: 300_000,
        },
        licenseRef: null,
        usage: "fixture-only",
        available: true,
      }),
      allowPlaceholderMusic: true,
    });

    // `errors` exists only on the failing branch, so asserting on it directly
    // passes against `undefined` and proves nothing. Assert `ok`, and print
    // what went wrong when it is not.
    expect(result.ok ? [] : result.errors.map((e) => `${e.code} at ${e.path}`)).toEqual([]);
    expect(result.ok).toBe(true);

    // The clip is there, and the validator agrees it is a real piece of media.
    const keepsake = edl.visualSegments.find((s) => "slotId" in s && s.slotId === "keepsake");
    expect(keepsake?.kind).toBe("broll");
  });
});

/**
 * The guard that would have caught the above without anyone looking.
 *
 * The keepsake bug's damage was not that a beat was missing — it was that
 * NOTHING SAID SO. Compose now compares what it was handed against what it
 * used, and any difference becomes a note in the stage log.
 */
describe("assets that never reach the film", () => {
  it("says so when a supplied photograph is placed nowhere", () => {
    const base = inputWith([]);
    const { notes } = composeFilm({
      ...base,
      stills: [...base.stills, { assetId: "still-orphan", slotId: "no_such_slot" }],
    });
    expect(notes.join(" ")).toContain("no_such_slot");
    expect(notes.join(" ")).toContain("does not appear in the film");
  });

  it("says so when a supplied clip is placed nowhere", () => {
    const base = inputWith([]);
    const { notes } = composeFilm({
      ...base,
      brollAssetIds: { ...base.brollAssetIds, no_such_slot: "clip-orphan" },
      assetDurationMs: { ...base.assetDurationMs, "clip-orphan": 20_000 },
    });
    expect(notes.join(" ")).toContain("no_such_slot");
  });

  /**
   * And stays quiet on a film where everything landed — otherwise it is noise
   * on every project and nobody reads it when it matters.
   */
  it("says nothing about a film that used everything it was given", () => {
    const { notes } = composeFilm(inputWith([]));
    expect(notes.filter((n) => n.includes("does not appear in the film"))).toEqual([]);
  });
});

describe("a film missing what the template said was optional", () => {
  it("has optional slots at all, or this test proves nothing", () => {
    expect(optionalSlotIds).toContain("keepsake");
    expect(optionalSlotIds).toContain("video_environment");
  });

  it("still composes when every optional slot is empty", () => {
    const { edl, notes } = composeFilm(inputWith(optionalSlotIds));
    expect(edl.visualSegments.length).toBeGreaterThan(0);
    // It says what it did rather than silently dropping a beat.
    expect(notes.join(" ")).toContain("keepsake");
  });

  it("closes on the group photograph when there is no keepsake", () => {
    const { edl } = composeFilm(inputWith(["keepsake"]));
    const slots = edl.visualSegments.map((s) => ("slotId" in s ? s.slotId : undefined));
    expect(slots).not.toContain("keepsake");
    expect(slots).toContain("photo_group");
  });

  it("keeps the keepsake when there is one", () => {
    const { edl } = composeFilm(inputWith([]));
    const slots = edl.visualSegments.map((s) => ("slotId" in s ? s.slotId : undefined));
    expect(slots).toContain("keepsake");
  });

  it("stays on the subject when an optional b-roll slot is empty", () => {
    const { edl, notes } = composeFilm(inputWith(["video_environment"]));
    const slots = edl.visualSegments.map((s) => ("slotId" in s ? s.slotId : undefined));
    expect(slots).not.toContain("video_environment");
    expect(notes.join(" ")).toContain("video_environment");
  });

  /**
   * The inverse, and the reason the first fix was not simply "make every slot
   * optional in compose": a slot the template DOES insist on must still be a
   * loud failure, because capture would never have let it through.
   */
  it("still refuses a film missing something the template requires", () => {
    expect(() => composeFilm(inputWith(["photo_group"]))).toThrow(/photo_group/);
  });
});

/**
 * The clips somebody actually films.
 *
 * The template asks for ten seconds of b-roll and every fixture obliges, so
 * compose cut the opening at 1000–5000ms and each insert at 1500–5500ms
 * without ever asking how long the clip was. The first person to film their
 * own b-roll filmed 1.1 to 2.7 seconds, and the EDL failed validation with
 * SOURCE_RANGE_OUTSIDE_ASSET — which names the segment and never the clip.
 *
 * These are that person's real durations.
 */
describe("b-roll shorter than the beat it fills", () => {
  const outsideAsset = (input: ComposeInput): string[] => {
    const { edl } = composeFilm(input);
    return edl.visualSegments
      .filter((s) => "sourceOutMs" in s && s.sourceOutMs !== undefined)
      .filter((s) => {
        const available = input.assetDurationMs[(s as { assetId: string }).assetId];
        return available !== undefined && (s as { sourceOutMs: number }).sourceOutMs > available;
      })
      .map((s) => s.id);
  };

  it("never asks for source a one-second clip does not have", () => {
    expect(outsideAsset(inputWith([], 1_133))).toEqual([]);
  });

  it("never asks for source a two-and-a-half-second clip does not have", () => {
    expect(outsideAsset(inputWith([], 2_667))).toEqual([]);
  });

  it("is unchanged when the clips are long enough", () => {
    expect(outsideAsset(inputWith([], 40_000))).toEqual([]);
  });

  it("opens on what the short clip has, and says so", () => {
    const input = inputWith([], 1_133);
    const { edl, notes } = composeFilm(input);
    const open = edl.visualSegments[0];
    expect(open?.durationMs).toBeLessThanOrEqual(1_133);
    expect(notes.join(" ")).toContain("opening clip");
  });

  /**
   * The rule the last two failures came down to: `conformance` outranks
   * `editing`.
   *
   * `photoHoldMs.min`, `brollMs.min` and the headroom an answer needs are
   * preferences. `requiredPhotoSlotIds` says the film is WRONG without that
   * shot. Dropping a required slot to honour a preference produced an EDL
   * that failed its own validator with REQUIRED_SLOT_MISSING — a film killed
   * by its own house style.
   */
  const requiredSlots = (t = template): string[] => {
    const c = t.conformance as {
      requiredPhotoSlotIds: readonly string[];
      requiredVideoSlotIds: readonly string[];
    };
    return [...c.requiredPhotoSlotIds, ...c.requiredVideoSlotIds];
  };

  const slotsUsed = (input: ComposeInput): Set<string> => {
    const { edl } = composeFilm(input);
    return new Set(
      edl.visualSegments
        .map((s) => ("slotId" in s ? s.slotId : undefined))
        .filter((s): s is string => s !== undefined),
    );
  };

  it("shows every required slot even when the clips are far too short", () => {
    const used = slotsUsed(inputWith([], 1_133));
    for (const slot of requiredSlots()) expect([...used]).toContain(slot);
  });

  it("shows every required slot when the optional ones are missing too", () => {
    const used = slotsUsed(inputWith(optionalSlotIds, 1_133));
    for (const slot of requiredSlots()) expect([...used]).toContain(slot);
  });

  /**
   * Short answers as well as short clips — 8.3 seconds is the real one that
   * dropped `photo_early`, because an answer needs about ten to carry an
   * insert without breaking the "on the subject first, back before the end"
   * rule.
   */
  it("shows every required slot when the answers are too short to carry inserts", () => {
    const used = slotsUsed(inputWith([], 1_133, 8_300));
    for (const slot of requiredSlots()) expect([...used]).toContain(slot);
  });

  it("never stacks more photographs than the template allows", () => {
    const { edl } = composeFilm(inputWith([], 1_133));
    const c = template.conformance as { maxConsecutivePhotos: number };
    let run = 0;
    let worst = 0;
    for (const s of edl.visualSegments) {
      run = s.kind === "photo" ? run + 1 : 0;
      worst = Math.max(worst, run);
    }
    expect(worst).toBeLessThanOrEqual(c.maxConsecutivePhotos);
  });

  it("stays on the subject rather than cutting to a clip too short to hold", () => {
    const { edl, notes } = composeFilm(inputWith([], 1_133));
    // brollMs.min is 2s; a 1.1s clip cannot be an insert, so no answer cuts
    // away to one.
    const inserts = edl.visualSegments.filter((s) => s.id.endsWith("_insert"));
    expect(inserts.every((s) => s.kind !== "broll")).toBe(true);
    expect(notes.join(" ")).toContain("too short to cut to");
  });
});
