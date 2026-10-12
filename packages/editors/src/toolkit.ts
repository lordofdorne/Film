import type { EDL, VisualSegment, WordCaption } from "@film/edl";
import type { Template } from "@film/templates";

import type { ComposeInput, SpeechRun } from "./material.js";

/**
 * The craft every editor needs and nobody should write twice.
 *
 * Keeping cuts contiguous on the timeline, laying captions over measured
 * speech, rounding to the grid without overrunning the media, timing a
 * question card for reading, noticing what was supplied and not used. Each of
 * these was learned the hard way in the life-advice editor — the comments say
 * how — and lives here so the next film type starts from the lesson rather
 * than repeating it.
 *
 * Editors differ in judgement: which moments, in what order, how long. Not in
 * this.
 */

export const GRID = 100;
/**
 * Reading time for a question card, before the template's clamp.
 *
 * 900ms to notice the cut plus 240ms a word — around 250 words a minute, which
 * is unhurried for a line somebody reads once, on a film they are watching
 * rather than skimming.
 */
export const READING_BASE_MS = 900;
export const READING_MS_PER_WORD = 240;

/**
 * A question's wording, for counting words and nothing else.
 *
 * The variant chosen here may not be the one this subject is asked, and that is
 * fine: this decides how long the card holds, not what it says. The words
 * themselves come from the template at render time, through the key.
 */
export const questionTextOf = (template: Template, questionId: string): string => {
  const spec = template.questions.find((q) => q.id === questionId)?.text;
  if (spec === undefined) return questionId;
  return typeof spec === "string" ? spec : spec.default;
};
export const grid = (ms: number): number => Math.round(ms / GRID) * GRID;

/**
 * Down to the grid, never up — for anything bounded by real media.
 *
 * `grid` rounds to the NEAREST 100ms, which is right for timeline positions
 * and wrong for the end of a source range: a take that is 16079ms long became
 * a request for 16100ms of it, and the EDL failed validation by 21
 * milliseconds. Recordings do not end on round numbers; fixtures do, which is
 * why every test passed for months.
 */
export const gridDown = (ms: number): number => Math.floor(ms / GRID) * GRID;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export const normalise = (word: string): string => word.toLowerCase().replace(/[^a-z0-9']/g, "");

/**
 * Word timings, distributed across the MEASURED speech runs rather than evenly
 * across the whole answer.
 *
 * This is a stand-in for forced alignment, which arrives with transcription in
 * Phase 4. Spreading words uniformly would drift badly wherever the speaker
 * paused — and these takes pause every two or three seconds. Allocating words
 * to runs in proportion to each run's length keeps captions honest across
 * pauses, even though word placement inside a run is still an estimate.
 */
/**
 * The words that belong to the first speech run of an answer.
 *
 * The share of the answer's words that `distributeWords` would put in run
 * zero, taken from the front. Not a guess at where the sentence ends — this
 * is a proportion, the same one the caption layout uses everywhere else, so
 * the two cannot drift apart and put a word on screen after the picture has
 * cut away from it.
 */
export const openingWords = (
  spoken: string,
  runs: readonly SpeechRun[],
): string[] => {
  const words = spoken.split(/\s+/).filter((w) => w.length > 0);
  const first = runs[0];
  if (first === undefined || words.length === 0) return words;

  const speaking = runs.reduce((total, r) => total + (r.endMs - r.startMs), 0);
  if (speaking <= 0) return words;

  const share = Math.round((words.length * (first.endMs - first.startMs)) / speaking);
  return words.slice(0, Math.min(words.length, Math.max(1, share)));
};

export const distributeWords = (
  words: readonly string[],
  runs: readonly SpeechRun[],
  spanStartMs: number,
  spanDurationMs: number,
): WordCaption[] => {
  const speaking = runs.reduce((total, r) => total + (r.endMs - r.startMs), 0);
  if (speaking <= 0 || words.length === 0) return [];

  // Allocate a word budget per run, never leaving a run empty and never
  // overrunning the total.
  const budgets: number[] = runs.map((r) =>
    Math.max(1, Math.round((words.length * (r.endMs - r.startMs)) / speaking)),
  );
  let allocated = budgets.reduce((a, b) => a + b, 0);
  for (let i = budgets.length - 1; i >= 0 && allocated > words.length; i--) {
    const take = Math.min((budgets[i] ?? 1) - 1, allocated - words.length);
    budgets[i] = (budgets[i] ?? 1) - take;
    allocated -= take;
  }
  const lastIndex = budgets.length - 1;
  budgets[lastIndex] = (budgets[lastIndex] ?? 0) + (words.length - allocated);

  const captions: WordCaption[] = [];
  let cursor = 0;
  runs.forEach((run, i) => {
    const count = budgets[i] ?? 0;
    if (count <= 0) return;
    const runStart = run.startMs - spanStartMs;
    const runLength = run.endMs - run.startMs;
    const slot = runLength / count;
    for (let k = 0; k < count; k++) {
      const word = words[cursor + k];
      if (word === undefined) break;
      const start = Math.round(runStart + slot * k);
      const end = Math.round(runStart + slot * (k + 1)) - 20;
      captions.push({
        text: word,
        startMs: clamp(start, 0, spanDurationMs - 2),
        endMs: clamp(Math.max(end, start + 1), 1, spanDurationMs),
      });
    }
    cursor += count;
  });

  // Enforce the invariants the validator will check anyway, so a rounding
  // collision here fails loudly here rather than confusingly later.
  let previousEnd = -1;
  return captions.map((w) => {
    const startMs = Math.max(w.startMs, previousEnd);
    const endMs = Math.max(startMs + 1, Math.min(w.endMs, spanDurationMs));
    previousEnd = endMs;
    return { text: w.text, startMs, endMs };
  });
};

export const findPhrase = (
  words: readonly string[],
  phrase: string,
): { startWord: number; endWord: number } | undefined => {
  const needle = phrase.split(/\s+/).map(normalise).filter((w) => w.length > 0);
  if (needle.length === 0) return undefined;
  const hay = words.map(normalise);
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, k) => hay[i + k] === w)) {
      return { startWord: i, endWord: i + needle.length - 1 };
    }
  }
  return undefined;
};

/**
 * Appends visual segments while maintaining the contiguity invariant:
 *
 *   start = previousEnd - transitionIn.durationMs
 *
 * Building the timeline through this rather than by hand is what stops a
 * hand-computed offset drifting a frame and failing validation 200 segments
 * later.
 */
/** Omit over a union must distribute, or every member collapses into one. */
export type Unplaced<T> = T extends unknown ? Omit<T, "startMs"> : never;

export class VisualTimeline {
  readonly segments: VisualSegment[] = [];
  #end = 0;

  push(segment: Unplaced<VisualSegment>): VisualSegment {
    const transition = segment.transitionIn.durationMs;
    const startMs = this.segments.length === 0 ? 0 : this.#end - transition;
    const placed = { ...segment, startMs } as VisualSegment;
    this.segments.push(placed);
    this.#end = startMs + placed.durationMs;
    return placed;
  }

  /**
   * Hold on the last segment for longer, so there is somewhere to put a
   * question card. A timed segment can only be held for as much source as it
   * has left — which is why subjects are asked to leave quiet at the end of a
   * take, and why this returns what it actually managed rather than assuming.
   */
  extendLast(wantedMs: number, assetDurationMs: Readonly<Record<string, number>>): number {
    const last = this.segments[this.segments.length - 1];
    if (last === undefined || wantedMs <= 0) return 0;

    let grow = wantedMs;
    if (last.kind === "interview" || last.kind === "broll") {
      const total = assetDurationMs[last.assetId];
      const available = total === undefined ? 0 : total - last.sourceOutMs;
      grow = Math.min(grow, Math.max(0, grid(available - GRID)));
      if (grow <= 0) return 0;
      last.sourceOutMs += grow;
    }
    last.durationMs += grow;
    this.#end += grow;
    return grow;
  }

  get endMs(): number {
    return this.#end;
  }
}

/**
 * Anything somebody supplied that did not make it into the film.
 *
 * This exists because of the keepsake. A clip filmed for a slot that accepts
 * clips was sorted into `brollAssetIds`, looked for in `stills`, and therefore
 * silently absent from the finished film — no error, no warning, no note, a
 * green tick on the card and a valid EDL. The specific bug is fixed above; this
 * is what stops the NEXT one being invisible.
 *
 * Deliberately a note rather than a failure. There are honest reasons an asset
 * goes unused — an answer with no speech in it is already skipped and said so —
 * and refusing to compose would turn a small disappointment into no film at
 * all. What was missing was not enforcement. It was anybody knowing.
 */
export const unusedAssetNotes = (input: ComposeInput, edl: EDL): string[] => {
  const used = new Set<string>();
  for (const segment of edl.visualSegments) {
    if ("assetId" in segment && typeof segment.assetId === "string") used.add(segment.assetId);
  }
  for (const segment of edl.speechSegments) used.add(segment.assetId);
  for (const segment of edl.promptSegments) {
    if ("assetId" in segment && typeof segment.assetId === "string") used.add(segment.assetId);
  }

  const supplied: { readonly assetId: string; readonly what: string }[] = [
    ...input.stills.map((s) => ({ assetId: s.assetId, what: `the "${s.slotId}" photograph` })),
    ...Object.entries(input.brollAssetIds).map(([slotId, assetId]) => ({
      assetId,
      what: `the "${slotId}" clip`,
    })),
    ...input.answers.map((a) => ({ assetId: a.assetId, what: `the answer to "${a.questionId}"` })),
  ];

  return supplied
    .filter((s) => !used.has(s.assetId))
    .map((s) => `${s.what} was supplied but does not appear in the film`);
};
