import { describe, expect, it } from "vitest";

import { getTemplate } from "@film/templates";

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

/** An answer long enough to carry an insert, so nothing is dropped for length. */
const answer = (questionId: string) => ({
  questionId,
  assetId: `asset-${questionId}`,
  durationMs: 30_000,
  runs: [{ startMs: 500, endMs: 29_000 }],
  spoken: "a sentence with a reasonable number of words in it for captions to sit on",
});

const inputWith = (skip: readonly string[]): ComposeInput => {
  const mediaSlots = ["photo_early", "photo_personality", "photo_group", "keepsake"];
  const brollSlots = ["video_personality", "video_group", "video_environment"];

  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    template,
    answers: QUESTION_IDS.map(answer),
    stills: mediaSlots
      .filter((slotId) => !skip.includes(slotId))
      .map((slotId) => ({ assetId: `still-${slotId}`, slotId })),
    brollAssetIds: Object.fromEntries(
      brollSlots.filter((s) => !skip.includes(s)).map((s) => [s, `broll-${s}`]),
    ),
    assetDurationMs: Object.fromEntries(
      QUESTION_IDS.map((q) => [`asset-${q}`, 40_000] as const),
    ),
    track: {
      id: "temp",
      beatGridMs: Array.from({ length: 200 }, (_, i) => i * 2000),
      cues: { titleMs: 12_000 },
    },
    promptQuestionIds: [],
  };
};

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
