import { describe, expect, it } from "vitest";

import { getTemplate } from "@film/templates";

import { editorFor, fittedAnswers, type ComposeInput } from "../src/index.js";
import { talk } from "./talk.js";

const template = getTemplate("life-advice", 1);

const filmOf = (sentences: number): ComposeInput => {
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
    track: { id: "temp", beatGridMs: [], cues: { titleMs: 9_000 } },
    promptQuestionIds: [],
  };
};

describe("fittedAnswers", () => {
  it("reports every shortened answer, from the cut itself", () => {
    const input = filmOf(20);
    const { edl, notes } = editorFor(template).edit(input);
    const fitted = fittedAnswers(edl, input.answers);

    // One report for every answer the editor said it shaped.
    expect(fitted.length).toBe(notes.filter((n) => n.includes("shaped to")).length);

    for (const f of fitted) {
      expect(f.usedMs).toBeLessThan(f.spokenMs);
      // Kept and left-out words are the whole answer, nothing lost or doubled.
      const leftOutWords = f.leftOut.join(" ").split(" ").length;
      expect(f.keptWords + leftOutWords).toBe(f.totalWords);
    }

    const love = fitted.find((f) => f.questionId === "love_lesson");
    // The restart is what goes first, and the person can see that it went.
    expect(love?.leftOut.some((p) => p.includes("Um, you know"))).toBe(true);
  });

  it("has nothing to say about a film nobody needed to shorten", () => {
    const input = filmOf(2);
    // Identity answers have a 5 s share and these are longer, so only those.
    const fitted = fittedAnswers(editorFor(template).edit(input).edl, input.answers);
    expect(fitted.every((f) => f.questionId.startsWith("identity_"))).toBe(true);
  });

  it("cannot report answers without word times, which were never shaped", () => {
    const input = filmOf(20);
    const typed = { ...input, answers: input.answers.map(({ words: _w, ...a }) => a) };
    expect(fittedAnswers(editorFor(template).edit(typed).edl, typed.answers)).toEqual([]);
  });
});
