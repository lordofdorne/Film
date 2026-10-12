import {
  chapterStart,
  nextStop,
  previousStep,
  type WizardStep,
  type WizardStop,
} from "@film/templates";

import type { ChapterSegment } from "../ui/index.js";

/**
 * The wizard's map, for the screens: hrefs, progress and time left, worked out
 * from the walk-through's rows on every render.
 *
 * Where to go is decided in @film/templates (`nextStop`), where it is tested;
 * this only turns those decisions into URLs and numbers a page can draw.
 */

/** The fields of a walk-through step this file reads. Both the hub's and a
 *  step sheet's shape satisfy it. */
export type MapStep = {
  readonly id: string;
  readonly ask: string;
  readonly kind: "question" | "slot" | "detail";
  readonly required: boolean;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly chapterBlurb: string;
  readonly chapterPrepare: readonly string[];
  readonly estimatedSeconds: number;
  readonly asset: unknown;
  readonly value: string | number | null;
};

export const isDone = (step: Pick<MapStep, "asset" | "value">): boolean =>
  step.asset !== null || (step.value !== null && step.value !== "");

const wizardSteps = (steps: readonly MapStep[]): WizardStep[] =>
  steps.map((step) => ({ id: step.id, chapterId: step.chapterId, done: isDone(step) }));

export const stopHref = (projectId: string, stop: WizardStop): string => {
  if (stop.kind === "review") return `/projects/${projectId}`;
  if (stop.kind === "chapter") return `/projects/${projectId}/chapter/${stop.chapterId}`;
  return `/projects/${projectId}/step/${stop.stepId}`;
};

export const stepHref = (projectId: string, stepId: string): string =>
  `/projects/${projectId}/step/${stepId}`;

/** Where finishing or skipping `fromStepId` leads. Null: arriving from outside. */
export const nextHref = (
  projectId: string,
  steps: readonly MapStep[],
  fromStepId: string | null,
): string => stopHref(projectId, nextStop(wizardSteps(steps), fromStepId));

/** One screen back: the previous step, or the overview from the first. */
export const backHref = (projectId: string, steps: readonly MapStep[], stepId: string): string => {
  const previous = previousStep(wizardSteps(steps), stepId);
  return previous === null ? `/projects/${projectId}` : stepHref(projectId, previous.id);
};

/** "Begin" on a chapter's intro. */
export const beginHref = (projectId: string, steps: readonly MapStep[], chapterId: string): string => {
  const first = chapterStart(wizardSteps(steps), chapterId);
  return first === undefined ? `/projects/${projectId}` : stepHref(projectId, first.id);
};

/**
 * "Not now" on a chapter's intro: wherever the wizard would go if this whole
 * chapter were behind them. Its steps stay unfinished — the review will say so.
 */
export const skipChapterHref = (
  projectId: string,
  steps: readonly MapStep[],
  chapterId: string,
): string => {
  const inChapter = steps.filter((step) => step.chapterId === chapterId);
  const last = inChapter[inChapter.length - 1];
  if (last === undefined) return `/projects/${projectId}`;
  const pretend = wizardSteps(steps).map((step) =>
    step.chapterId === chapterId ? { ...step, done: true } : step,
  );
  return stopHref(projectId, nextStop(pretend, last.id));
};

export type Chapter<S extends MapStep = MapStep> = {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly prepare: readonly string[];
  /** 1-based, for "Part 2 of 4". */
  readonly number: number;
  readonly steps: readonly S[];
};

export const chaptersOf = <S extends MapStep>(steps: readonly S[]): readonly Chapter<S>[] => {
  const chapters: { id: string; title: string; blurb: string; prepare: readonly string[]; steps: S[] }[] = [];
  for (const step of steps) {
    let chapter = chapters.find((c) => c.id === step.chapterId);
    if (chapter === undefined) {
      chapter = {
        id: step.chapterId,
        title: step.chapterTitle,
        blurb: step.chapterBlurb,
        prepare: step.chapterPrepare,
        steps: [],
      };
      chapters.push(chapter);
    }
    chapter.steps.push(step);
  }
  return chapters.map((chapter, index) => ({ ...chapter, number: index + 1 }));
};

export type Progress = {
  readonly done: number;
  readonly total: number;
  readonly segments: readonly ChapterSegment[];
  /** "About 14 minutes left", honest about what is required and nothing else. */
  readonly timeLeft: string;
  readonly secondsLeft: number;
};

export const progressOf = (steps: readonly MapStep[], currentChapterId?: string): Progress => {
  const secondsLeft = steps
    .filter((step) => step.required && !isDone(step))
    .reduce((sum, step) => sum + step.estimatedSeconds, 0);
  return {
    done: steps.filter(isDone).length,
    total: steps.length,
    segments: chaptersOf(steps).map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      total: chapter.steps.length,
      done: chapter.steps.filter(isDone).length,
      current: chapter.id === currentChapterId,
    })),
    timeLeft: timeLeft(secondsLeft),
    secondsLeft,
  };
};

export const timeLeft = (seconds: number): string => {
  if (seconds <= 0) return "Nothing required left";
  if (seconds < 60) return "Less than a minute left";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "About a minute left" : `About ${String(minutes)} minutes left`;
};

/** "About 15 minutes" for a chapter's intro: the whole chapter, done or not. */
export const durationOf = (steps: readonly MapStep[]): string => {
  const minutes = Math.max(1, Math.round(steps.reduce((s, x) => s + x.estimatedSeconds, 0) / 60));
  return minutes === 1 ? "about a minute" : `about ${String(minutes)} minutes`;
};

/** What the All steps sheet lists: every step, its state, and where it lives. */
export type OutlineChapter = {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly {
    readonly id: string;
    readonly ask: string;
    readonly done: boolean;
    readonly required: boolean;
    readonly href: string;
  }[];
};

export const outlineOf = (projectId: string, steps: readonly MapStep[]): readonly OutlineChapter[] =>
  chaptersOf(steps).map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    steps: chapter.steps.map((step) => ({
      id: step.id,
      ask: step.ask,
      done: isDone(step),
      required: step.required,
      href: stepHref(projectId, step.id),
    })),
  }));

/** What the bar shows on one screen of the wizard. */
export type FrameStop = {
  /** "Their story · 5 of 10", or "Part 2 of 4". */
  readonly where: string;
  readonly backHref: string;
  readonly chapterId: string;
};

/**
 * Everything the wizard's bar needs, for every screen at once.
 *
 * The bar lives in a layout so it stays on screen while the middle changes —
 * and a layout is not re-rendered when you move between the pages inside it.
 * So rather than each page telling the bar where it is, the layout works out
 * the bar for every step and every chapter intro in one go, and the bar picks
 * its entry from the URL. It is a few dozen short strings; the alternative was
 * rebuilding the bar, the progress and the All steps sheet on every tap.
 *
 * Keyed `step:<id>` and `chapter:<id>`, the two kinds of screen there are.
 */
export type FrameMap = {
  readonly stops: Readonly<Record<string, FrameStop>>;
  /** With no chapter marked current: the bar marks the one it is in. */
  readonly progress: Progress;
  readonly outline: readonly OutlineChapter[];
};

export const frameMapOf = (projectId: string, steps: readonly MapStep[]): FrameMap => {
  const chapters = chaptersOf(steps);
  const stops: Record<string, FrameStop> = {};
  for (const chapter of chapters) {
    const first = chapter.steps[0];
    stops[`chapter:${chapter.id}`] = {
      where: `Part ${String(chapter.number)} of ${String(chapters.length)}`,
      backHref: first === undefined ? `/projects/${projectId}` : backHref(projectId, steps, first.id),
      chapterId: chapter.id,
    };
    chapter.steps.forEach((step, index) => {
      stops[`step:${step.id}`] = {
        where: `${chapter.title} · ${String(index + 1)} of ${String(chapter.steps.length)}`,
        backHref: backHref(projectId, steps, step.id),
        chapterId: chapter.id,
      };
    });
  }
  return { stops, progress: progressOf(steps), outline: outlineOf(projectId, steps) };
};
