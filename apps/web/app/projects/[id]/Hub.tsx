import Link from "next/link";

import type { HubStep, HubView } from "../../../src/server/capture.js";
import { FreshenOnReturn } from "./FreshenOnReturn.js";
import { MakeFilmButton } from "./MakeFilmButton.js";

/**
 * The hub is the product: one overview of everything the film still needs.
 *
 * Every ask is a card — done, missing, optional — and tapping one opens just
 * that capture. People choose their own order, see the whole shape, and can
 * put the phone down and pick it up somewhere else in the list. There is no
 * sequence to be trapped in, which is why there is no Next anywhere.
 *
 * Server-rendered from rows. Coming back three days later on another device
 * renders the same page, because none of this lives in React state.
 */
export const Hub = ({ walkthrough }: { readonly walkthrough: HubView }) => {
  const steps = walkthrough.steps;
  const done = steps.filter(isDone);
  const secondsLeft = steps
    .filter((s) => s.required && !isDone(s))
    .reduce((sum, s) => sum + s.estimatedSeconds, 0);

  const name = walkthrough.subject.displayName ?? walkthrough.subject.subjectName;

  const chapters = new Map<string, HubStep[]>();
  for (const step of steps) {
    const list = chapters.get(step.chapterId) ?? [];
    list.push(step);
    chapters.set(step.chapterId, list);
  }

  return (
    <main className="page">
      {/* Thumbnails here are signed URLs with a fifteen-minute life, pointing
          at the small stills the thumbnail stage makes — never at the
          customer's originals. */}
      <FreshenOnReturn />
      <header className="hub-head">
        <h1 className="title">{name === undefined ? "Your film" : `${name}’s film`}</h1>
        <p className="muted">
          {done.length} of {steps.length} done
          {secondsLeft > 0 && ` · about ${minutesLeft(secondsLeft)} left`}
        </p>
        {/*
          What has been said so far, which is what the film is made of.

          "of answers" rather than a predicted film length: the finished
          duration depends on the edit, and a number that turns out wrong on
          the preview screen is worse than no number. One short answer is
          nothing; this is what makes five of them visible while there is
          still time to add to it.
        */}
        {walkthrough.spokenSecondsSoFar > 0 && (
          <p className="tiny">
            {spokenSoFar(walkthrough.spokenSecondsSoFar)} of answers recorded
          </p>
        )}
        <div className="track">
          <div
            className="track__fill"
            style={{ width: `${String(Math.round((done.length / Math.max(1, steps.length)) * 100))}%` }}
          />
        </div>
      </header>

      {[...chapters.entries()].map(([chapterId, chapterSteps]) => (
        <section key={chapterId} className="chapter">
          <h2 className="eyebrow">{chapterSteps[0]?.chapterTitle}</h2>
          <p className="lede chapter__blurb">{chapterSteps[0]?.chapterBlurb}</p>
          <ul className="list chapter__cards">
            {chapterSteps.map((step) => (
              <StepCard key={step.id} projectId={walkthrough.projectId} step={step} />
            ))}
          </ul>
        </section>
      ))}

      <footer className="hub-foot">
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

const isDone = (step: HubStep): boolean =>
  step.asset !== null || (step.value !== null && step.value !== "");

const minutesLeft = (seconds: number): string => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "a minute" : `${String(minutes)} minutes`;
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
      <Link href={`/projects/${projectId}/step/${step.id}`} className="card step-card">
        <span className={done ? "mark mark--done" : "mark"} aria-hidden>
          {done ? "✓" : "○"}
        </span>
        <span className="step-card__body">
          <span className={done ? "step-card__ask" : "step-card__ask step-card__ask--open"}>{step.ask}</span>
          <span className="step-card__note">
            {!step.required && !done && "optional"}
            {done && step.value !== null && step.value !== "" && String(step.value)}
            {step.qcNote !== undefined && ` · ${step.qcNote}`}
          </span>
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
      </Link>
    </li>
  );
};

