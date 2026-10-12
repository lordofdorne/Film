import type { EDL, QuestionPromptSegment, SpeechSegment } from "@film/edl";
import { questionTextKey } from "@film/templates";

import type { ComposeInput, ComposeResult, IngestedAnswer, SpeechRun, StillAsset } from "../material.js";
import { shapeAnswer } from "../shaping.js";
import { alignToRuns, captionsWithin, timedWordsOf } from "../words.js";
import { READING_BASE_MS, READING_MS_PER_WORD, questionTextOf, grid, gridDown, clamp, openingWords, distributeWords, findPhrase, VisualTimeline, unusedAssetNotes } from "../toolkit.js";

/**
 * The life-advice film: somebody's answers to ten questions, opened on a
 * candid moment and their greatest lesson, closed on what they would say to
 * whoever watches.
 *
 * Moved here unchanged from the pipeline's compose stage in Phase 9, Block 1.
 * The beats below are this film type's and no other's — the order of the
 * moments, which question feeds each one, which photographs go where. Shared
 * craft lives in `../toolkit.ts`; what is here is judgement about this film.
 */
export const editLifeAdvice = (input: ComposeInput): ComposeResult => {
  const { template } = input;
  const editing = template.editing as {
    preRollHandleMs: number;
    postRollHandleMs: number;
    crossfadeMs: number;
    fadeMs: number;
    photoHoldMs: { min: number; max: number };
    brollMs: { min: number; max: number };
    openingContextMs: { min: number; max: number };
    adaptiveSpeechMs: { lean: number; rich: number };
    minSubjectVisibleBeforeInsertMs: number;
    returnToSubjectBeforeAnswerEndsMs: number;
  };

  const notes: string[] = [];

  /**
   * How much the person actually said, and how much room the pictures get
   * because of it.
   *
   * Every range in `editing` — photo holds, b-roll, the opening — used to be
   * read as its minimum and nothing else, so a film built from twenty minutes
   * of answers was cut exactly as tightly as one built from ninety seconds.
   * The template declared elasticity that compose never used.
   *
   * `fit` is that elasticity, driven by the one thing we cannot control and
   * must not assume: how long people talk for. Near 0 the film is brisk and
   * every hold is its shortest; near 1 it breathes. It is measured before any
   * beat is laid out, so every duration below is decided by the same number
   * and the film is proportionate to itself rather than to a target somebody
   * else's footage suggested.
   *
   * It does NOT stretch a short film to look like a long one. Padding thin
   * material with slow photographs makes it feel thin AND slow; a two-minute
   * film should be a good two-minute film.
   */
  const speechMs = input.answers.reduce((total, a) => {
    const first = a.runs[0];
    const last = a.runs[a.runs.length - 1];
    return first === undefined || last === undefined ? total : total + (last.endMs - first.startMs);
  }, 0);

  const { lean, rich } = editing.adaptiveSpeechMs;
  const fit = rich <= lean ? 0 : clamp((speechMs - lean) / (rich - lean), 0, 1);

  /** A duration from one of the template's declared ranges, at this film's fit. */
  const flex = (range: { min: number; max: number }): number =>
    grid(range.min + (range.max - range.min) * fit);

  const byQuestion = new Map(input.answers.map((a) => [a.questionId, a]));
  const answer = (id: string): IngestedAnswer => {
    const found = byQuestion.get(id);
    if (found === undefined) throw new Error(`no ingested answer for question "${id}"`);
    return found;
  };
  /**
   * How long a question card stays up: enough to read it, no longer.
   *
   * Derived from the question's own length rather than fixed, because "What
   * have you learned about love?" and "What would you like to say to whoever
   * watches this?" are not the same read. Clamped to the template's range so a
   * pathological question cannot stall the film.
   *
   * Deliberately outside the adaptive-length system. Every other duration here
   * flexes with how much was said; reading speed does not, and a lean film
   * whose cards flashed past would be unreadable exactly when it is shortest.
   */
  const questionCardMs = (questionId: string): number => {
    const text = questionTextOf(template, questionId);
    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    const { min, max } = template.questionPrompt.cardMs;
    return grid(clamp(READING_BASE_MS + words * READING_MS_PER_WORD, min, max));
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
        durationMs: flex(editing.photoHoldMs),
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
    const shot = sourceWindow(assetId, 0, flex(editing.brollMs), 1000);
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
  const WANTED_OPENING_MS = flex(editing.openingContextMs);
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
  /**
   * With timed words and nobody's choice of phrase, the words on screen are
   * the words actually spoken in that first run — not a share of the answer
   * sized to its length, which could end a word early or late.
   */
  const lessonTimed = timedWordsOf(lesson);
  const timedCold =
    lesson.coldOpen === undefined && lessonTimed !== undefined
      ? captionsWithin(
          alignToRuns(lessonTimed, lesson.runs),
          coldRun.startMs,
          coldRun.endMs,
          coldRun.startMs,
          coldSpeechDur,
        )
      : [];
  speech.push({
    id: "s_cold_open",
    questionId: lesson.questionId,
    assetId: lesson.assetId,
    startMs: coldSpeechStart,
    durationMs: coldSpeechDur,
    sourceInMs: grid(coldRun.startMs),
    sourceOutMs: grid(coldRun.startMs) + coldSpeechDur,
    captions:
      timedCold.length > 0
        ? timedCold
        : distributeWords(coldWords, [coldRun], coldRun.startMs, coldSpeechDur),
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

  type BeatOptions = {
    runs?: readonly SpeechRun[];
    insert?: InsertPlan;
    transitionIn?: { type: "cut" | "crossfade" | "fade"; durationMs: number };
    idSuffix?: string;
    /** Speech this beat may use, when the answer's share is partly spent
     *  elsewhere (the greatest lesson's cold open). */
    budgetMs?: number;
  };

  /** One continuous stretch of an answer on screen: the card, the shot, any
   *  insert, the captions. Every beat was exactly this until Phase 9. */
  const placeAnswer = (
    questionId: string,
    options: BeatOptions & { card?: boolean } = {},
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

    /**
     * The question, on a card of its own, before the answer.
     *
     * Watching the film, you could not tell what was being asked. The prompt
     * machinery existed — three modes in the schema, a planner branch, a
     * renderer, three golden frames — and had never once fired for a customer,
     * because `promptQuestionIds` came from a project config that browser
     * capture created empty. Every EDL ever composed had `promptSegments: []`.
     *
     * It is a black card now rather than text held over the previous shot, and
     * that is a deliberate change of two things at once.
     *
     * The LOOK: the same treatment as the end title, which is the one piece of
     * text in this film that already reads well.
     *
     * The RELIABILITY: the old card was made by holding on the previous take's
     * quiet tail, and was dropped when there wasn't one — silently, apart from
     * a note nobody reads. With people recording their own answers that would
     * have failed often and unpredictably, which is the complaint that started
     * this. A card of its own always appears.
     *
     * The cost is honest and was accepted deliberately: roughly fifteen
     * seconds on a two-minute film, and a more sectioned rhythm.
     */
    if (options.card !== false && input.promptQuestionIds.includes(questionId)) {
      visual.push({
        id: `v_card_${questionId}${suffix}`,
        kind: "black",
        durationMs: questionCardMs(questionId),
        transitionIn: FADE,
        textKey: questionTextKey(questionId),
        textStyle: "question",
      });
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
              ? flex(editing.photoHoldMs) + 1000
              : flex(editing.brollMs) + 2000,
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
    /**
     * The words spoken in THIS piece, at the times they were spoken.
     *
     * Spreading the whole answer across `runs` was right when it was the whole
     * answer, and wrong for the greatest lesson's main part, which plays every
     * run but the first: the cold open's words were squeezed back in at the
     * front of it. Timed words go where they were said, so each piece shows
     * its own. Without timings, the old spreading stands.
     */
    const timed = timedWordsOf(a);
    const timedCaptions =
      timed === undefined
        ? []
        : captionsWithin(alignToRuns(timed, a.runs), speechStart, speechEnd, speechStart, speechDur);
    const words =
      timedCaptions.length > 0
        ? timedCaptions.map((c) => c.text)
        : a.spoken.split(/\s+/).filter((w) => w.length > 0);
    const captions =
      timedCaptions.length > 0 ? timedCaptions : distributeWords(words, runs, speechStart, speechDur);

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

  /**
   * An answer, fitted to its share of the film.
   *
   * Within its share — or with no word times to shape by, which is every film
   * made before Phase 9 — it is placed exactly as it always was. Over its
   * share, it is shaped (`shapeAnswer`): long pauses out, then the strongest
   * whole sentences kept, and each kept stretch is placed as its own piece.
   *
   * Pieces join on a cut, and every piece gets the next framing in the scale
   * cycle, so a cut inside an answer reads as a punch-in rather than a jump —
   * the documentary convention for exactly this. Only the first piece gets
   * the question card, and the insert goes on the longest piece, the one most
   * likely to have room for it.
   */
  const addAnswerBeat = (questionId: string, options: BeatOptions = {}): void => {
    const a = answer(questionId);
    const share = template.questions.find((q) => q.id === questionId)?.shareSeconds;
    const timed = timedWordsOf(a);
    const runs = options.runs ?? a.runs;
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (share === undefined || timed === undefined || first === undefined || last === undefined) {
      placeAnswer(questionId, options);
      return;
    }

    const words = alignToRuns(timed, a.runs).filter((w) => {
      const middle = (w.startMs + w.endMs) / 2;
      return middle >= first.startMs && middle <= last.endMs;
    });
    const budgetMs = options.budgetMs ?? share * 1000;
    const shaped = shapeAnswer(words, budgetMs, a.emphasis?.phrase);
    if (shaped.untouched || shaped.spans.length === 0) {
      placeAnswer(questionId, options);
      return;
    }

    const longest = shaped.spans.reduce(
      (best, span, i) => (span.endMs - span.startMs > (shaped.spans[best]?.endMs ?? 0) - (shaped.spans[best]?.startMs ?? 0) ? i : best),
      0,
    );
    const suffix = options.idSuffix ?? "";
    shaped.spans.forEach((span, i) => {
      // The measured speech inside this piece: its runs, clipped to it.
      const pieceRuns = runs
        .filter((r) => r.endMs > span.startMs && r.startMs < span.endMs)
        .map((r) => ({ startMs: Math.max(r.startMs, span.startMs), endMs: Math.min(r.endMs, span.endMs) }));
      const { insert: _insert, transitionIn: _transition, ...rest } = options;
      placeAnswer(questionId, {
        ...rest,
        runs: pieceRuns,
        idSuffix: `${suffix}_${String(i + 1)}`,
        card: i === 0,
        ...(i === 0 && options.transitionIn !== undefined ? { transitionIn: options.transitionIn } : {}),
        ...(i === longest && options.insert !== undefined ? { insert: options.insert } : {}),
      });
    });

    const seconds = (ms: number): string => `${String(Math.round(ms / 1000))} s`;
    notes.push(
      shaped.keptUnits === shaped.units
        ? `"${questionId}": ${seconds(shaped.spokenMs)} tightened to ${seconds(shaped.keptMs)} by taking out long pauses; every word kept`
        : `"${questionId}": ${seconds(shaped.spokenMs)} shaped to ${seconds(shaped.keptMs)} (share ${seconds(budgetMs)}): kept ${String(shaped.keptUnits)} of ${String(shaped.units)} sentences`,
    );
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
    // The cold open is the first part of this answer's share.
    budgetMs: Math.max(
      0,
      (template.questions.find((q) => q.id === "greatest_lesson")?.shareSeconds ?? 0) * 1000 -
        (coldRun.endMs - coldRun.startMs),
    ),
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
   *
   * It may be a PHOTOGRAPH OR A CLIP, and that is the whole of the second bug
   * here. The template declares `accepts: ["photo", "video"]` for this slot and
   * the step sheet duly offers "Take a video" — but compose sorts a video into
   * `brollAssetIds` and this looked only in `stills`. So somebody who filmed
   * the object they were asked for got a green tick, a clean ingest, a film
   * that composed without a single warning, and no object in it. The worst
   * shape a bug can have in this product: they did exactly what was asked and
   * the result quietly lacked it.
   *
   * The clip gets the same slot in the rhythm as the photograph would, and as
   * much of it as there is, so the ending is the same length either way.
   */
  const keepsakeStill = input.stills.find((s) => s.slotId === "keepsake");
  const keepsakeClip = input.brollAssetIds["keepsake"];
  const KEEPSAKE_MS = flex(editing.photoHoldMs) + 600;
  const group = still("photo_group");

  if (keepsakeStill !== undefined) {
    visual.push({
      id: "v_keepsake",
      kind: "photo",
      durationMs: KEEPSAKE_MS,
      transitionIn: XFADE,
      assetId: keepsakeStill.assetId,
      slotId: keepsakeStill.slotId,
      focalPoint: { x: 0.5, y: 0.5 },
      motion: "still",
      intensity: 0,
      entry: "insetExpand",
    });
  } else if (keepsakeClip !== undefined) {
    // A second is the floor below which a cut is a flinch rather than a shot,
    // the same floor every other insert uses.
    const shot = sourceWindow(keepsakeClip, 0, KEEPSAKE_MS, 1000);
    if (shot === undefined) {
      notes.push(
        "the keepsake clip is too short to hold a beat; the film closes on the group photograph",
      );
    } else {
      visual.push({
        id: "v_keepsake",
        kind: "broll",
        durationMs: shot.durationMs,
        transitionIn: XFADE,
        assetId: keepsakeClip,
        slotId: "keepsake",
        sourceInMs: shot.inMs,
        sourceOutMs: shot.inMs + shot.durationMs,
      });
    }
  } else {
    notes.push("no keepsake was added; the film closes on the group photograph");
  }
  visual.push({
    id: "v_group_still",
    kind: "photo",
    durationMs: flex(editing.photoHoldMs) + 600,
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

  for (const note of unusedAssetNotes(input, edl)) notes.push(note);
  return { edl, notes };
};
