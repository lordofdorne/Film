"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { useEffect, useRef } from "react";

import type { FrameMap, OutlineChapter, Progress } from "../../../src/server/wizard.js";
import { OfflineNotice } from "./OfflineNotice.js";
import { UploadStatus } from "./UploadStatus.js";
import {
  Button,
  ChapterProgress,
  Icon,
  IconButton,
  Sheet,
  SheetClose,
  StatusMark,
} from "../../../src/ui/index.js";

/**
 * The frame around every wizard screen: one moment at a time, never a corridor.
 *
 * Three promises the owner asked for in August, and where each one lives:
 *   - honest time remaining — the line under the progress, from the
 *     template's own estimates, counting only what is still required;
 *   - never feeling trapped — Back on the left, and on the right the whole
 *     walk-through one tap away, any step openable, with Save and leave;
 *   - reassurance after each take — the step screens' own business.
 *
 * It is drawn by the wizard's layout, not by each page, so it stays on screen
 * while the middle changes: moving forward swaps one screen's content rather
 * than rebuilding the bar, the progress and the All steps sheet every time.
 * That is why it reads where it is from the URL. A layout is not re-rendered
 * between its pages, so it cannot be told; it is handed the bar for every
 * screen (`frameMapOf`) and picks its own.
 *
 * When a save changes what is done, the action's `revalidatePath` sends a
 * fresh layout back with its response, so the progress moves without a
 * reload.
 */
export const WizardFrame = ({
  projectId,
  map,
  children,
}: {
  readonly projectId: string;
  readonly map: FrameMap;
  readonly children: React.ReactNode;
}) => {
  // ["step", "<id>"] or ["chapter", "<id>"], relative to this layout.
  const [kind, id] = useSelectedLayoutSegments();
  const key = `${kind ?? ""}:${id ?? ""}`;
  const stop = map.stops[key];
  const currentStepId = kind === "step" ? id : undefined;

  /**
   * Which way the screen moves: in from the right going forward, from the
   * left going back, so the motion says where you went. The stops are in
   * walk-through order, so comparing positions is enough. Read during render
   * against the previous screen's position, which the effect then moves on.
   */
  const position = Object.keys(map.stops).indexOf(key);
  const previous = useRef(position);
  const direction = position < previous.current ? "back" : "forward";
  useEffect(() => {
    previous.current = position;
  }, [position]);

  const progress: Progress = {
    ...map.progress,
    segments: map.progress.segments.map((segment) => ({
      ...segment,
      current: segment.id === stop?.chapterId,
    })),
  };

  return (
    <div className="wz" data-direction={direction}>
      <header className="wz-bar">
        <div className="wz-bar__row">
          <IconButton label="Back" asChild>
            <Link href={stop?.backHref ?? `/projects/${projectId}`}>
              <Icon name="back" size={18} />
            </Link>
          </IconButton>
          <p className="wz-bar__where">{stop?.where ?? ""}</p>
          <AllSteps
            projectId={projectId}
            progress={progress}
            outline={map.outline}
            {...(currentStepId === undefined ? {} : { currentStepId })}
          />
        </div>
        <div className="wz-bar__progress">
          <ChapterProgress
            chapters={progress.segments}
            label={`${String(progress.done)} of ${String(progress.total)} done`}
          />
          <p className="wz-bar__meta">
            <span>
              {progress.done} of {progress.total} done
            </span>
            <span>{progress.timeLeft}</span>
          </p>
          <UploadStatus />
        </div>
      </header>
      <OfflineNotice />
      {children}
    </div>
  );
};

/**
 * The overview, as a sheet: what the hub was, one tap away from any screen.
 * Every step is a link, so the wizard's order is a suggestion rather than a
 * rule.
 */
const AllSteps = ({
  projectId,
  progress,
  outline,
  currentStepId,
}: {
  readonly projectId: string;
  readonly progress: Progress;
  readonly outline: readonly OutlineChapter[];
  readonly currentStepId?: string;
}) => (
  <Sheet
    title="All steps"
    description={`${String(progress.done)} of ${String(progress.total)} done · ${progress.timeLeft.toLowerCase()}`}
    trigger={
      <button type="button" className="ui-btn ui-btn--ghost wz-bar__all">
        <Icon name="list" size={18} />
        <span>All steps</span>
      </button>
    }
    footer={
      <div className="wz-sheet-foot">
        <Button variant="secondary" block asChild>
          <Link href={`/projects/${projectId}`}>See the overview</Link>
        </Button>
        <Button variant="quiet" block asChild>
          <Link href="/">Save and leave</Link>
        </Button>
        <p className="tiny centred">Everything is saved as you go. Come back any time.</p>
      </div>
    }
  >
    {outline.map((chapter) => (
      <section key={chapter.id} className="wz-outline">
        <h3 className="eyebrow">{chapter.title}</h3>
        <ul className="list wz-outline__list">
          {chapter.steps.map((step) => (
            <li key={step.id}>
              <SheetClose asChild>
                <Link
                  href={step.href}
                  className="wz-outline__row"
                  aria-current={step.id === currentStepId ? "step" : undefined}
                >
                  <StatusMark done={step.done} />
                  <span className="wz-outline__ask">{step.ask}</span>
                  {!step.required && !step.done && <span className="tiny">Optional</span>}
                </Link>
              </SheetClose>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </Sheet>
);
