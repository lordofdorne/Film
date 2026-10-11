import Link from "next/link";

import type { OutlineChapter, Progress } from "../../../src/server/wizard.js";
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
 */
export const WizardFrame = ({
  projectId,
  backHref,
  where,
  progress,
  outline,
  currentStepId,
  children,
}: {
  readonly projectId: string;
  readonly backHref: string;
  /** "Their story · 5 of 10", or "Part 2 of 4". */
  readonly where: string;
  readonly progress: Progress;
  readonly outline: readonly OutlineChapter[];
  readonly currentStepId?: string;
  readonly children: React.ReactNode;
}) => (
  <div className="wz">
    <header className="wz-bar">
      <div className="wz-bar__row">
        <IconButton label="Back" asChild>
          <Link href={backHref}>
            <Icon name="back" size={18} />
          </Link>
        </IconButton>
        <p className="wz-bar__where">{where}</p>
        <AllSteps
          projectId={projectId}
          progress={progress}
          outline={outline}
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
      </div>
    </header>
    {children}
  </div>
);

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
