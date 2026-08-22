import type {
  EDL,
  QuestionPromptSegment,
  SpeechSegment,
  VisualSegment,
  WordCaption,
} from "@film/edl";
import type { Template } from "@film/templates";
import type { SpeechRun } from "../media/ffmpeg.js";

/** Everything ingest learned about one recorded answer. */
export type IngestedAnswer = {
  readonly questionId: string;
  readonly assetId: string;
  readonly durationMs: number;
  /** Measured speech, relative to the ingested file. */
  readonly runs: readonly SpeechRun[];
  readonly spoken: string;
  /** Present on the answer that also supplies the cold open. */
  readonly coldOpen?: string;
  readonly emphasis?: { readonly phrase: string; readonly tone: "funny" | "meaningful" | "surprising" };
};

export type StillAsset = { readonly assetId: string; readonly slotId: string };

export type ComposeInput = {
  readonly projectId: string;
  readonly template: Template;
  readonly answers: readonly IngestedAnswer[];
  readonly stills: readonly StillAsset[];
  readonly brollAssetIds: Readonly<Record<string, string>>;
  /** assetId -> full duration, so a hold knows how much source is left. */
  readonly assetDurationMs: Readonly<Record<string, number>>;
  readonly track: {
    readonly id: string;
    readonly beatGridMs: readonly number[];
    readonly cues: { readonly titleMs: number };
  };
  readonly promptQuestionIds: readonly string[];
};

const GRID = 100;
/** How long a question card wants to be on screen before the answer. */
const PROMPT_MS = 1800;
const MIN_PROMPT_MS = 900;
const grid = (ms: number): number => Math.round(ms / GRID) * GRID;

/**
 * Down to the grid, never up — for anything bounded by real media.
 *
 * `grid` rounds to the NEAREST 100ms, which is right for timeline positions
 * and wrong for the end of a source range: a take that is 16079ms long became
 * a request for 16100ms of it, and the EDL failed validation by 21
 * milliseconds. Recordings do not end on round numbers; fixtures do, which is
 * why every test passed for months.
 */
const gridDown = (ms: number): number => Math.floor(ms / GRID) * GRID;
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

const normalise = (word: string): string => word.toLowerCase().replace(/[^a-z0-9']/g, "");

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

const distributeWords = (
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

const findPhrase = (
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
type Unplaced<T> = T extends unknown ? Omit<T, "startMs"> : never;

class VisualTimeline {
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

export type ComposeResult = {
  readonly edl: EDL;
  readonly notes: string[];
};

export const composeFilm = (input: ComposeInput): ComposeResult => {
  const { template } = input;
  const editing = template.editing as {
    preRollHandleMs: number;
    postRollHandleMs: number;
    crossfadeMs: number;
    fadeMs: number;
    photoHoldMs: { min: number; max: number };
    brollMs: { min: number; max: number };
    minSubjectVisibleBeforeInsertMs: number;
    returnToSubjectBeforeAnswerEndsMs: number;
  };

  const notes: string[] = [];
  const byQuestion = new Map(input.answers.map((a) => [a.questionId, a]));
  const answer = (id: string): IngestedAnswer => {
    const found = byQuestion.get(id);
    if (found === undefined) throw new Error(`no ingested answer for question "${id}"`);
    return found;
  };
  const still = (slotId: string): StillAsset => {
    const found = input.stills.find((s) => s.slotId === slotId);
    if (found === undefined) throw new Error(`no still supplied for slot "${slotId}"`);
    return found;
  };
  const broll = (slotId: string): string => {
    const found = input.brollAssetIds[slotId];
    if (found === undefined) throw new Error(`no b-roll supplied for slot "${slotId}"`);
    return found;
  };

  /**
   * A source window that the clip actually contains.
   *
   * Compose used to cut b-roll as though every clip were long enough for the
   * beat it was filling — the opening asked for 1000–5000ms, the inserts for
   * 1500–5500ms. The template asks for ten seconds and the fixtures oblige,
   * so nothing caught it; the first person to film their own ten seconds
   * filmed one and a half, and the EDL failed validation with
   * SOURCE_RANGE_OUTSIDE_ASSET — which names the segment and not the clip.
   *
   * Backing the start off toward zero before shortening is deliberate: a short
   * clip is usually short because somebody stopped recording early, not
   * because it starts late, so the interesting part is at the front.
   *
   * Returns nothing when even the floor cannot be met, and the caller decides
   * what a film does without that shot.
   */
  const sourceWindow = (
    assetId: string,
    wantInMs: number,
    wantDurationMs: number,
    floorMs: number,
  ): { readonly inMs: number; readonly durationMs: number } | undefined => {
    const available = input.assetDurationMs[assetId];
    // Unknown duration: ingest records one for every video, so this is a
    // fixture or a bug. Behave as before rather than silently dropping a shot.
    if (available === undefined || available <= 0) {
      return { inMs: wantInMs, durationMs: wantDurationMs };
    }

    // gridDown, never grid: a 2667ms clip rounded to 2700 overran its own end
    // by 33ms — the very failure this function exists to prevent, put back by
    // the rounding inside the fix. Caught by testing a real clip length.
    const inMs = gridDown(Math.max(0, Math.min(wantInMs, available - wantDurationMs)));
    const durationMs = gridDown(Math.min(wantDurationMs, available - inMs));
    return durationMs < floorMs ? undefined : { inMs, durationMs };
  };

  const visual = new VisualTimeline();
  const speech: SpeechSegment[] = [];
  const prompts: QuestionPromptSegment[] = [];

  const PRE = editing.preRollHandleMs;
  const POST = editing.postRollHandleMs;
  const CUT = { type: "cut", durationMs: 0 } as const;
  const XFADE = { type: "crossfade", durationMs: editing.crossfadeMs } as const;
  const FADE = { type: "fade", durationMs: editing.fadeMs } as const;

  /**
   * The slots the template says a film is wrong without.
   *
   * Read here so the beat planner can tell a preference from a requirement:
   * a shot that is merely shorter than we would like still has to appear.
   */
  const conformance = template.conformance as {
    requiredPhotoSlotIds: readonly string[];
    requiredVideoSlotIds: readonly string[];
  };
  const requiredSlotIds = new Set([
    ...conformance.requiredPhotoSlotIds,
    ...conformance.requiredVideoSlotIds,
  ]);

  /**
   * Put a required shot on screen on its own, when it could not be woven into
   * an answer. Returns false only when there is genuinely nothing to show,
   * which is a missing REQUIRED slot and rightly fails validation later.
   */
  const placeRequiredSlot = (
    insert: { readonly kind: "photo" | "broll"; readonly slotId: string },
    id: string,
  ): boolean => {
    if (insert.kind === "photo") {
      const s = input.stills.find((x) => x.slotId === insert.slotId);
      if (s === undefined) return false;
      visual.push({
        id,
        kind: "photo",
        durationMs: grid(editing.photoHoldMs.min),
        transitionIn: XFADE,
        assetId: s.assetId,
        slotId: s.slotId,
        focalPoint: { x: 0.5, y: 0.45 },
        motion: "in",
        intensity: 0.2,
        entry: "cut",
      });
      return true;
    }

    const assetId = input.brollAssetIds[insert.slotId];
    if (assetId === undefined) return false;
    // A second is the floor below which a cut is a flinch rather than a shot.
    const shot = sourceWindow(assetId, 0, editing.brollMs.min, 1000);
    if (shot === undefined) return false;
    visual.push({
      id,
      kind: "broll",
      durationMs: shot.durationMs,
      transitionIn: XFADE,
      assetId,
      slotId: insert.slotId,
      sourceInMs: shot.inMs,
      sourceOutMs: shot.inMs + shot.durationMs,
    });
    return true;
  };

  /* ── 1. opening context: b-roll under the opening line ─────────────── */
  const WANTED_OPENING_MS = 4000;
  const openAsset = broll("video_personality");
  /**
   * As much of the opening as the clip can carry, down to a second. A short
   * opening is a small compromise; a film that will not compose is not.
   */
  const open =
    sourceWindow(openAsset, 1000, WANTED_OPENING_MS, 1000) ??
    sourceWindow(openAsset, 0, WANTED_OPENING_MS, 0) ??
    { inMs: 0, durationMs: WANTED_OPENING_MS };
  const OPENING_MS = open.durationMs;
  if (OPENING_MS < WANTED_OPENING_MS) {
    notes.push(
      `the opening clip is only ${String(OPENING_MS)}ms; the film opens on what there is`,
    );
  }
  visual.push({
    id: "v_open",
    kind: "broll",
    durationMs: OPENING_MS,
    transitionIn: CUT,
    overlayTextKey: "opening",
    assetId: openAsset,
    slotId: "video_personality",
    sourceInMs: open.inMs,
    sourceOutMs: open.inMs + OPENING_MS,
  });

  /* ── 2. cold open ──────────────────────────────────────────────────── */
  const lesson = answer("greatest_lesson");
  const coldRun = lesson.runs[0];
  if (coldRun === undefined) throw new Error("greatest_lesson has no speech");

  // The main title must land on the track's title cue, so the cold open's
  // PICTURE is stretched to fill the gap using the pause the speaker left.
  // Speech is not moved to satisfy music; only the hold after it is.
  const coldVisualDur = grid(
    clamp(input.track.cues.titleMs - OPENING_MS, 2000, lesson.durationMs - coldRun.startMs + PRE),
  );
  const coldSourceIn = grid(Math.max(0, coldRun.startMs - PRE));
  const coldStart = visual.endMs - XFADE.durationMs;
  visual.push({
    id: "v_cold_open",
    kind: "interview",
    durationMs: coldVisualDur,
    transitionIn: XFADE,
    assetId: lesson.assetId,
    sourceInMs: coldSourceIn,
    sourceOutMs: coldSourceIn + coldVisualDur,
    scale: 1,
  });

  const coldSpeechStart = grid(coldStart + (coldRun.startMs - coldSourceIn));
  const coldSpeechDur = grid(coldRun.endMs - coldRun.startMs);
  /**
   * The cold open's words, and a fallback that is not optional.
   *
   * `coldOpen` is a human choice — the phrase somebody picked to open the film
   * with — and intake types it in. Nothing in the browser does, and neither
   * does transcription: it produces what was said, not which part of it is the
   * hook. So for every film a customer makes themselves, this was empty, and
   * an empty caption list fails the EDL schema at `speechSegments.0.captions`
   * — a permanent compose failure with no hint that a missing OPTIONAL field
   * caused it.
   *
   * The fallback is the opening of the answer itself, which is what the
   * picture is showing anyway: this segment plays the first speech run of
   * "the greatest lesson", so the words on screen should be the words spoken
   * in that run. Sized by the same proportion `distributeWords` would use, so
   * the captions do not run past the end of the run.
   */
  const coldWords =
    lesson.coldOpen === undefined
      ? openingWords(lesson.spoken, lesson.runs)
      : lesson.coldOpen.split(/\s+/).filter((w) => w.length > 0);
  speech.push({
    id: "s_cold_open",
    questionId: lesson.questionId,
    assetId: lesson.assetId,
    startMs: coldSpeechStart,
    durationMs: coldSpeechDur,
    sourceInMs: grid(coldRun.startMs),
    sourceOutMs: grid(coldRun.startMs) + coldSpeechDur,
    captions: distributeWords(coldWords, [coldRun], coldRun.startMs, coldSpeechDur),
  });

  /* ── 3. main title, on the cue ─────────────────────────────────────── */
  visual.push({
    id: "v_main_title",
    kind: "title",
    durationMs: 5000,
    transitionIn: FADE,
    textKey: "mainTitle",
    reveal: "sequential",
  });

  /* ── answer beats ──────────────────────────────────────────────────── */
  type InsertPlan =
    | { kind: "photo"; slotId: string; motion: "in" | "out" | "panLeft" | "panRight"; entry: "cut" | "insetExpand" }
    | { kind: "broll"; slotId: string };

  let beatIndex = 0;
  const scaleCycle: (1 | 1.06 | 1.1)[] = [1, 1.06, 1, 1.1];

  const addAnswerBeat = (
    questionId: string,
    options: {
      runs?: readonly SpeechRun[];
      insert?: InsertPlan;
      transitionIn?: { type: "cut" | "crossfade" | "fade"; durationMs: number };
      idSuffix?: string;
    } = {},
  ): void => {
    const a = answer(questionId);
    const runs = options.runs ?? a.runs;
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first === undefined || last === undefined) {
      notes.push(`skipped "${questionId}": no speech detected`);
      return;
    }

    const suffix = options.idSuffix ?? "";
    const speechStart = first.startMs;
    const speechEnd = last.endMs;
    const sourceIn = grid(Math.max(0, speechStart - PRE));
    /**
     * Never past the end of the take. The `Math.min` was already here and
     * already correct; `grid` then rounded the capped value back UP past the
     * duration it had just been capped to.
     *
     * Only bites when the grid would overshoot the real end — a take that
     * comfortably outlasts its speech is cut exactly as before, so no film
     * that already composed changes.
     */
    const sourceOut = Math.min(grid(speechEnd + POST), gridDown(a.durationMs));
    const totalDur = sourceOut - sourceIn;
    if (totalDur < 1000) {
      notes.push(`skipped "${questionId}": usable range too short`);
      return;
    }

    // A question card needs room BEFORE the answer, so it is made by holding
    // on the previous shot rather than by moving speech. If the previous take
    // has no quiet tail left to hold on, the card is dropped and said so.
    if (input.promptQuestionIds.includes(questionId)) {
      const gap = template.questionPrompt.answerGapMs;
      const grown = visual.extendLast(grid(PROMPT_MS + gap), input.assetDurationMs);
      if (grown >= MIN_PROMPT_MS + gap) {
        const promptDur = grown - gap;
        const questionText = template.questions.find((q: { id: string }) => q.id === questionId)?.text;
        const pattern =
          questionText === undefined
            ? questionId
            : typeof questionText === "string"
              ? questionText
              : questionText.default;
        const promptWords = pattern.split(/\s+/).filter((w: string) => w.length > 0);
        // Sequential, non-overlapping slots across the first 70% of the card,
        // so the last word has landed before the answer starts.
        const slot = Math.floor((promptDur * 0.7) / promptWords.length);
        prompts.push({
          id: `p_${questionId}`,
          questionId,
          mode: "text-only",
          startMs: grid(visual.endMs - grown),
          durationMs: promptDur,
          captions: promptWords.map((text: string, i: number) => ({
            text,
            startMs: slot * i,
            endMs: i === promptWords.length - 1 ? promptDur : slot * (i + 1) - 10,
          })),
        });
      } else {
        notes.push(
          `no quiet tail before "${questionId}" to hold a question card on; card dropped`,
        );
      }
    }

    const transitionIn = options.transitionIn ?? CUT;
    const beatStart = visual.endMs - transitionIn.durationMs;
    // Source position is a pure function of timeline position within the beat,
    // which is what keeps every split piece lip-synced to one speech segment.
    const sourceAt = (t: number): number => sourceIn + (t - beatStart);

    const scale = scaleCycle[beatIndex % scaleCycle.length] ?? 1;
    beatIndex += 1;

    // Decide whether the answer is long enough to carry an insert without
    // breaking the "2s on the subject first, back to them before the end" rule.
    const wantedInsertDur =
      options.insert === undefined
        ? 0
        : grid(
            options.insert.kind === "photo"
              ? editing.photoHoldMs.min + 1000
              : editing.brollMs.min + 2000,
          );

    /**
     * How much of the b-roll clip there actually is, decided BEFORE the beat
     * is planned.
     *
     * It has to be up here because the insert's length is what splits the
     * answer into its two halves — discovering the clip was short at push
     * time would leave arithmetic that no longer adds up. A clip that cannot
     * fill `brollMs.min` is not used at all: the template says an insert is
     * two to six seconds, and a one-second cutaway is not a shorter version
     * of that shot, it is a flinch.
     */
    const brollShot =
      options.insert === undefined || options.insert.kind === "photo"
        ? undefined
        : (() => {
            const assetId = input.brollAssetIds[options.insert.slotId];
            if (assetId === undefined) return undefined;
            return sourceWindow(assetId, 1500, wantedInsertDur, editing.brollMs.min);
          })();

    const insertDur =
      options.insert !== undefined && options.insert.kind === "broll"
        ? (brollShot?.durationMs ?? wantedInsertDur)
        : wantedInsertDur;

    const before = editing.minSubjectVisibleBeforeInsertMs;
    const after = editing.returnToSubjectBeforeAnswerEndsMs;
    /**
     * An insert whose slot is empty is not an error.
     *
     * `video_environment` and `keepsake` are `required: false` in the
     * template, so the hub lets somebody finish a film without them — and
     * then compose demanded them anyway and failed permanently, which is a
     * film killed by a step the customer was told was optional. The two
     * halves have to agree about what a film needs, and the template is the
     * one holding the answer.
     */
    const haveMedia =
      options.insert === undefined
        ? false
        : options.insert.kind === "photo"
          ? input.stills.some((s) => s.slotId === options.insert?.slotId)
          : brollShot !== undefined;

    const canInsert =
      options.insert !== undefined && haveMedia && totalDur >= before + insertDur + after + 2000;

    if (!canInsert) {
      if (options.insert !== undefined && !haveMedia) {
        const slotId = options.insert.slotId;
        notes.push(
          input.brollAssetIds[slotId] === undefined && !input.stills.some((s) => s.slotId === slotId)
            ? `nothing in slot "${slotId}"; "${questionId}" stays on the subject`
            : `the clip in "${slotId}" is too short to cut to; "${questionId}" stays on the subject`,
        );
      } else if (options.insert !== undefined) {
        notes.push(
          `"${questionId}" too short (${String(totalDur)}ms) for an insert; kept on the subject`,
        );
      }
      visual.push({
        id: `v_${questionId}${suffix}`,
        kind: "interview",
        durationMs: totalDur,
        transitionIn,
        assetId: a.assetId,
        sourceInMs: sourceIn,
        sourceOutMs: sourceIn + totalDur,
        scale,
      });

      /**
       * A slot the template REQUIRES gets its own beat rather than being lost.
       *
       * The editorial minimums — `photoHoldMs.min`, `brollMs.min`, the
       * headroom an answer needs to carry an insert — are preferences.
       * `conformance.requiredPhotoSlotIds` is not: it says the film is wrong
       * without this shot. So when a preference would drop a required slot,
       * the preference yields and the shot is placed on its own, right where
       * it would have been cut in.
       *
       * Here rather than appended at the end, deliberately: an answer plays
       * before it and another after, so a recovered photograph cannot stack up
       * against the closing stills and break `maxConsecutivePhotos`.
       */
      const rescue = options.insert;
      if (rescue !== undefined && requiredSlotIds.has(rescue.slotId)) {
        const placed = placeRequiredSlot(rescue, `v_${questionId}${suffix}_required`);
        if (placed) {
          notes.push(`"${rescue.slotId}" is required, so it gets a beat of its own`);
        }
      }
    } else {
      const insert = options.insert;
      if (insert === undefined) throw new Error("unreachable");
      const partA = grid(clamp(Math.round(totalDur * 0.42), before, totalDur - insertDur - after));
      const partB = totalDur - partA - insertDur;

      visual.push({
        id: `v_${questionId}${suffix}_a`,
        kind: "interview",
        durationMs: partA,
        transitionIn,
        assetId: a.assetId,
        sourceInMs: sourceIn,
        sourceOutMs: sourceIn + partA,
        scale,
      });

      if (insert.kind === "photo") {
        const s = still(insert.slotId);
        visual.push({
          id: `v_${questionId}${suffix}_insert`,
          kind: "photo",
          durationMs: insertDur,
          transitionIn: CUT,
          assetId: s.assetId,
          slotId: s.slotId,
          focalPoint: { x: 0.5, y: 0.42 },
          motion: insert.motion,
          intensity: 0.35,
          entry: insert.entry,
        });
      } else {
        // Guaranteed by canInsert: haveMedia is brollShot !== undefined.
        const shot = brollShot ?? { inMs: 1500, durationMs: insertDur };
        visual.push({
          id: `v_${questionId}${suffix}_insert`,
          kind: "broll",
          durationMs: insertDur,
          transitionIn: CUT,
          assetId: broll(insert.slotId),
          slotId: insert.slotId,
          sourceInMs: shot.inMs,
          sourceOutMs: shot.inMs + insertDur,
        });
      }

      const resumeStart = beatStart + partA + insertDur;
      const resumeSource = sourceAt(resumeStart);
      visual.push({
        id: `v_${questionId}${suffix}_b`,
        kind: "interview",
        durationMs: partB,
        transitionIn: CUT,
        assetId: a.assetId,
        sourceInMs: resumeSource,
        sourceOutMs: resumeSource + partB,
        scale,
      });
    }

    const speechStartMs = grid(beatStart + (speechStart - sourceIn));
    const speechDur = grid(speechEnd - speechStart);
    const words = a.spoken.split(/\s+/).filter((w) => w.length > 0);
    const captions = distributeWords(words, runs, speechStart, speechDur);

    const emphasis =
      a.emphasis === undefined ? undefined : findPhrase(words, a.emphasis.phrase);
    if (a.emphasis !== undefined && emphasis === undefined) {
      notes.push(
        `emphasis phrase not found in "${questionId}" spoken text; no emphasis applied`,
      );
    }

    speech.push({
      id: `s_${questionId}${suffix}`,
      questionId,
      assetId: a.assetId,
      startMs: speechStartMs,
      durationMs: speechDur,
      sourceInMs: grid(speechStart),
      sourceOutMs: grid(speechStart) + speechDur,
      captions,
      ...(emphasis !== undefined && a.emphasis !== undefined
        ? { emphasis: { ...emphasis, tone: a.emphasis.tone } }
        : {}),
    });

  };

  /* ── 4. identity ───────────────────────────────────────────────────── */
  addAnswerBeat("identity_name", { transitionIn: FADE });
  addAnswerBeat("identity_age");
  addAnswerBeat("identity_birth_year");

  /* ── 5-10. the body ────────────────────────────────────────────────── */
  addAnswerBeat("longevity", {
    insert: { kind: "photo", slotId: "photo_early", motion: "in", entry: "insetExpand" },
  });
  addAnswerBeat("greatest_lesson", {
    runs: lesson.runs.slice(1),
    idSuffix: "_main",
    insert: { kind: "broll", slotId: "video_group" },
  });
  addAnswerBeat("advice_for_young_people", {
    insert: { kind: "photo", slotId: "photo_personality", motion: "panRight", entry: "cut" },
  });
  addAnswerBeat("meaning_of_group", {
    insert: { kind: "photo", slotId: "photo_group", motion: "out", entry: "insetExpand" },
  });
  addAnswerBeat("love_lesson", {
    insert: { kind: "broll", slotId: "video_environment" },
  });
  addAnswerBeat("closing_message");

  /* ── 11. keepsake, then the group photo ────────────────────────────── */
  /**
   * The keepsake is optional, and the closing sequence has to survive without
   * it. This called `still("keepsake")` and threw — so a customer who skipped
   * the card the hub had marked "optional" got a film that failed to compose,
   * hours later, with no way to connect the two.
   *
   * Skipped rather than substituted: the group photo that follows is the real
   * ending, and an object nobody chose would be worse than no object.
   */
  const keepsake = input.stills.find((s) => s.slotId === "keepsake");
  const group = still("photo_group");
  if (keepsake === undefined) {
    notes.push("no keepsake was added; the film closes on the group photograph");
  } else {
    visual.push({
      id: "v_keepsake",
      kind: "photo",
      durationMs: 4600,
      transitionIn: XFADE,
      assetId: keepsake.assetId,
      slotId: keepsake.slotId,
      focalPoint: { x: 0.5, y: 0.5 },
      motion: "still",
      intensity: 0,
      entry: "insetExpand",
    });
  }
  visual.push({
    id: "v_group_still",
    kind: "photo",
    durationMs: 4600,
    transitionIn: XFADE,
    assetId: group.assetId,
    slotId: group.slotId,
    focalPoint: { x: 0.5, y: 0.5 },
    motion: "in",
    intensity: 0.25,
    entry: "cut",
  });

  /* ── 12. end title ─────────────────────────────────────────────────── */
  visual.push({
    id: "v_black_beat",
    kind: "black",
    durationMs: 2400,
    transitionIn: FADE,
  });
  visual.push({
    id: "v_end_title",
    kind: "title",
    durationMs: 5000,
    transitionIn: CUT,
    textKey: "endTitle",
    reveal: "sequential",
  });

  /* ── 13. optional bonus ────────────────────────────────────────────── */
  addAnswerBeat("bonus_interviewer", { transitionIn: FADE });

  /* ── 14. dedication ────────────────────────────────────────────────── */
  visual.push({
    id: "v_dedication",
    kind: "title",
    durationMs: 6000,
    transitionIn: FADE,
    textKey: "closing",
    reveal: "fade",
  });

  const totalDurationMs = visual.endMs;

  const edl: EDL = {
    version: "1.0",
    projectId: input.projectId,
    templateId: template.id,
    templateVersion: template.version,
    fps: 30,
    totalDurationMs,
    audio: {
      musicTrackId: input.track.id,
      musicStartMs: 0,
      musicGainDb: template.audioDefaults.musicGainDb,
      duckDb: template.audioDefaults.duckDb,
      beatGridMs: [...input.track.beatGridMs],
    },
    visualSegments: visual.segments,
    promptSegments: prompts,
    speechSegments: speech,
  };

  return { edl, notes };
};
