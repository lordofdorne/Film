import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { getTemplate, TEMPLATE_REGISTRY, type Template } from "@film/templates";

import { editorFor, type ComposeInput } from "../src/index.js";
import { talk } from "./talk.js";
import { validate } from "./validate.js";

/**
 * The life-advice editor's cut of six films, checked in.
 *
 * Written on 2026-10-12 by the editor as it was BEFORE Phase 9 moved it out of
 * the pipeline, and compared byte for byte after the move — together with the
 * five real films in the development database — to show the move changed no
 * film. From here they hold that line: a change to the editor that changes a
 * cut fails here, and has to be made on purpose.
 *
 * On purpose looks like: bump the editor's version (so compose re-cuts the
 * films it affects), then `UPDATE_GOLDEN=1 pnpm test packages/editors` and
 * read the diff of these files as the review of what changed in the films.
 *
 * They cover how people actually differ: an average talker, a very short one,
 * a very long one, the optional photo and clip skipped, clips shorter than a
 * beat wants, every question on a card — and, since version 5, answers with
 * word times from transcription.
 */
const template = getTemplate("life-advice", 1);
const QUESTION_IDS = template.questions.map((q) => q.id);

/** An answer with pauses in it, the way a person recorded actually sounds. */
const answer = (questionId: string, durationMs: number) => {
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

const film = (
  skip: readonly string[],
  answerMs: number,
  clipMs: number,
  cards: readonly string[],
): ComposeInput => {
  const photoSlots = ["photo_early", "photo_personality", "photo_group", "keepsake"];
  const clipSlots = ["video_personality", "video_group", "video_environment"];
  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    template,
    answers: QUESTION_IDS.map((q) => answer(q, answerMs)),
    stills: photoSlots
      .filter((s) => !skip.includes(s))
      .map((slotId) => ({ assetId: `still-${slotId}`, slotId })),
    brollAssetIds: Object.fromEntries(
      clipSlots.filter((s) => !skip.includes(s)).map((s) => [s, `broll-${s}`]),
    ),
    assetDurationMs: {
      ...Object.fromEntries(QUESTION_IDS.map((q) => [`asset-${q}`, answerMs + 10_000] as const)),
      ...Object.fromEntries(clipSlots.map((s) => [`broll-${s}`, clipMs] as const)),
    },
    track: {
      id: "temp",
      beatGridMs: Array.from({ length: 200 }, (_, i) => i * 2000),
      cues: { titleMs: 12_000 },
    },
    promptQuestionIds: cards,
  };
};

/**
 * Every answer the recorded take from takes/, with its word times: the
 * editor's timed-caption path (version 5), which the other six never reach.
 */
const recorded = JSON.parse(
  readFileSync(new URL("./takes/take-recorded.json", import.meta.url), "utf8"),
) as { text: string; words: { text: string; startMs: number; endMs: number }[]; runs: { startMs: number; endMs: number }[] };

const timedFilm = (): ComposeInput => {
  const base = film([], 20_001, 40_000, []);
  return {
    ...base,
    answers: base.answers.map((a) => ({
      ...a,
      durationMs: 20_001,
      runs: recorded.runs,
      spoken: recorded.text,
      words: recorded.words,
    })),
  };
};

/**
 * Every answer a long, timed take — about seventy seconds of somebody who
 * pauses to think, restarts, and keeps going. The film shaping exists for.
 */
const longTimedFilm = (): ComposeInput => {
  const base = film([], 80_000, 40_000, []);
  return {
    ...base,
    answers: base.answers.map((a) => {
      const t = talk(20);
      return { ...a, durationMs: t.durationMs, runs: t.runs, spoken: t.text, words: t.words };
    }),
    assetDurationMs: {
      ...base.assetDurationMs,
      ...Object.fromEntries(base.answers.map((a) => [a.assetId, talk(20).durationMs] as const)),
    },
  };
};

const FILMS: Record<string, ComposeInput> = {
  "everything-average": film([], 30_000, 40_000, []),
  "short-talker": film([], 6_000, 40_000, []),
  "long-talker": film([], 240_000, 40_000, []),
  "no-optional-slots": film(["keepsake", "video_environment"], 30_000, 40_000, []),
  "short-clips": film([], 30_000, 2_500, []),
  "with-question-cards": film([], 30_000, 40_000, QUESTION_IDS),
  "timed-words": timedFilm(),
  "long-timed-talker": longTimedFilm(),
};

const goldenPath = (name: string): URL => new URL(`./golden/life-advice.${name}.json`, import.meta.url);

describe("the life-advice editor's cut", () => {
  it.each(Object.keys(FILMS))("%s is unchanged", async (name) => {
    const input = FILMS[name];
    if (input === undefined) throw new Error(name);
    const cut = JSON.stringify(editorFor(template).edit(input), null, 1);
    if (process.env["UPDATE_GOLDEN"] === "1") await writeFile(goldenPath(name), cut);
    expect(cut).toBe(await readFile(goldenPath(name), "utf8"));
  });
});

describe("every template", () => {
  const templates: readonly Template[] = Object.values(TEMPLATE_REGISTRY).flatMap((versions) =>
    Object.values(versions),
  );

  it.each(templates.map((t) => [`${t.id}@${String(t.version)}`, t] as const))(
    "%s names an editor that exists",
    (_name, t) => {
      expect(() => editorFor(t)).not.toThrow();
    },
  );

  it("names the editor in the error when one does not exist", () => {
    expect(() => editorFor({ ...template, editor: "no-such-editor" })).toThrow(/no-such-editor/);
  });
});

describe("a film from long answers, shaped", () => {
  const input = longTimedFilm();
  const { edl, notes } = editorFor(template).edit(input);

  it("is a film the validator accepts", () => {
    const result = validate({ ...input, template }, edl);
    if (!result.ok) throw new Error(JSON.stringify(result.errors.slice(0, 3)));
    expect(result.ok).toBe(true);
  });

  it("gives every answer no more than its share, give or take its opening thought", () => {
    // A unit is kept whole even when the first one alone is over; in this
    // talk no unit is longer than about four seconds.
    const TOLERANCE_MS = 4_000;
    for (const q of template.questions) {
      if (q.shareSeconds === undefined) continue;
      const spoken = edl.speechSegments
        .filter((s) => s.questionId === q.id)
        .reduce((t, s) => t + s.durationMs, 0);
      expect(spoken, q.id).toBeLessThanOrEqual(q.shareSeconds * 1000 + TOLERANCE_MS);
    }
  });

  it("lands near the template's length instead of the length of what was said", () => {
    const said = input.answers.reduce((t, a) => t + a.durationMs, 0);
    expect(said).toBeGreaterThan(10 * 60_000);
    expect(edl.totalDurationMs).toBeLessThanOrEqual(template.targetDurationMs.max + 30_000);
  });

  it("says what it shaped", () => {
    expect(notes.filter((n) => n.includes("shaped to")).length).toBeGreaterThan(5);
  });
});
