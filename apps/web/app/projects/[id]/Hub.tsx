import Link from "next/link";

import type { HubStep, HubView } from "../../../src/server/capture.js";
import { DeleteFilmButton } from "./DeleteFilmButton.js";
import { FreshenOnReturn } from "./FreshenOnReturn.js";
import { MakeFilmButton } from "./MakeFilmButton.js";
import { UploadStatus } from "./UploadStatus.js";
import { chaptersOf, isDone, progressOf } from "../../../src/server/wizard.js";
import { Button, Card, ChapterProgress, Icon, StatusMark } from "../../../src/ui/index.js";

/**
 * The overview: the whole film at a glance, and the review before making it.
 *
 * It used to be the only way through — every ask a card, tap one, come back.
 * The wizard now leads by default, and this is what the wizard's "All steps"
 * opens onto and where it ends: what is done, what is left, how long that
 * will take, and one primary action — Continue while anything is left, Make
 * my film once nothing required is.
 *
 * Server-rendered from rows. Coming back three days later on another device
 * renders the same page, because none of this lives in React state.
 */
export const Hub = ({
  walkthrough,
}: {
  readonly walkthrough: HubView;
  /** A confirmation already in this person's inbox, if any. */
}) => {
  const steps = walkthrough.steps;
  const progress = progressOf(steps);
  const name = walkthrough.subject.displayName ?? walkthrough.subject.subjectName;
  const ready = walkthrough.missing.length === 0;
  const untouched = progress.done === 0;

  return (
    <main className="page ov">
      {/* Thumbnails here are signed URLs with a fifteen-minute life, pointing
          at the small stills the thumbnail stage makes — never at the
          customer's originals. */}
      <FreshenOnReturn />

      <header className="ov-head">
        <p className="eyebrow">Your film</p>
        <h1 className="display">{name === undefined ? "Your film" : `${name}’s film`}</h1>
        <ChapterProgress
          chapters={progress.segments}
          label={`${String(progress.done)} of ${String(progress.total)} done`}
        />
        <p className="ov-head__meta">
          <span>
            {progress.done} of {progress.total} done
          </span>
          <span aria-hidden>·</span>
          <span>{progress.timeLeft}</span>
          {/*
            What has been said so far, which is what the film is made of.

            "of answers" rather than a predicted film length: the finished
            duration depends on the edit, and a number that turns out wrong on
            the preview screen is worse than no number. One short answer is
            nothing; this is what makes five of them visible while there is
            still time to add to it.
          */}
          {walkthrough.spokenSecondsSoFar > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{spokenSoFar(walkthrough.spokenSecondsSoFar)} of answers</span>
            </>
          )}
        </p>
        <UploadStatus />
      </header>

      {!ready && (
        <Card className="ov-next">
          <div>
            <p className="heading">{untouched ? "Ready when you are" : "Pick up where you left off"}</p>
            <p className="muted">
              {walkthrough.missing.length === 1
                ? "1 thing still needed before the film can be made."
                : `${String(walkthrough.missing.length)} things still needed before the film can be made.`}
            </p>
          </div>
          <Button size="lg" asChild>
            <Link href={`/projects/${walkthrough.projectId}/continue`}>
              {untouched ? "Start" : "Continue"}
              <Icon name="forward" size={18} />
            </Link>
          </Button>
        </Card>
      )}

      {chaptersOf(steps).map((chapter) => (
        <section key={chapter.id} className="ov-chapter">
          <div className="ov-chapter__head">
            <h2 className="heading">{chapter.title}</h2>
            <span className="tiny">
              {chapter.steps.filter(isDone).length} of {chapter.steps.length}
            </span>
          </div>
          <p className="muted">{chapter.blurb}</p>
          <ul className="list ov-chapter__steps">
            {chapter.steps.map((step) => (
              <StepCard key={step.id} projectId={walkthrough.projectId} step={step} />
            ))}
          </ul>
        </section>
      ))}

      <div className="delete-film">
        <DeleteFilmButton
          projectId={walkthrough.projectId}
          name={name === undefined ? null : `${name}’s film`}
        />
      </div>

      {/* Sticky only once there is something to press: a disabled button
          following somebody down the page is a nag, not a promise. */}
      <footer className={ready ? "hub-foot hub-foot--ready" : "hub-foot hub-foot--waiting"}>
        {/* The same `missing` that drew the cards drives the gate, so this page
            cannot say "all done" beside a disabled button. */}
        <MakeFilmButton
          projectId={walkthrough.projectId}
          stillMissing={walkthrough.missing.length}
        />
      </footer>
    </main>
  );
};

/**
 * Seconds until it is worth speaking in minutes.
 *
 * Rounding forty seconds up to "a minute" would overstate what is there on
 * the one screen whose job is to be honest about how the film is going.
 */
const spokenSoFar = (seconds: number): string => {
  if (seconds < 90) return `${String(Math.round(seconds))} seconds`;
  const minutes = seconds / 60;
  const rounded = Math.round(minutes * 2) / 2;
  return `${rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)} minutes`;
};

const StepCard = ({
  projectId,
  step,
}: {
  readonly projectId: string;
  readonly step: HubStep;
}) => {
  const done = isDone(step);
  return (
    <li>
      <Link href={`/projects/${projectId}/step/${step.id}`} className="ov-step">
        <StatusMark done={done} />
        <span className="step-card__body">
          <span className={done ? "step-card__ask" : "step-card__ask step-card__ask--open"}>{step.ask}</span>
          {(!step.required && !done) ||
          (done && step.value !== null && step.value !== "") ||
          step.qcNote !== undefined ? (
            <span className="step-card__note">
              {!step.required && !done && "Optional"}
              {done && step.value !== null && step.value !== "" && String(step.value)}
              {step.qcNote !== undefined && (done && step.value !== null ? ` · ${step.qcNote}` : step.qcNote)}
            </span>
          ) : null}
        </span>
        {step.asset !== null && (
          <span className="step-card__thumb-holder">
            {/*
              The thumbnail, or nothing. Never the original.

              This card used to draw `step.asset.url` — the customer's own file
              — as an <img> for a photograph and a <video preload="metadata">
              for a take. Measured on one real film: the hub referenced 105 MB
              across 18 assets to draw eighteen 56-pixel squares, and fetched
              it again on every visit and every window focus, because a fresh
              signature each render means the browser cache can never hit.

              A grey square for the few seconds before ingest has been is the
              price, and it is the right way round: a card that falls back to
              the original is a card that is slow forever on exactly the films
              whose ingest is already cached.
            */}
            {step.asset.thumbUrl === undefined ? (
              <span className="thumb thumb--waiting" aria-hidden />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed
              // URLs are short-lived and remote patterns would have to be open.
              <img src={step.asset.thumbUrl} alt="" className="thumb" loading="lazy" />
            )}
          </span>
        )}
        <Icon name="forward" size={18} className="ov-step__chev" />
      </Link>
    </li>
  );
};

