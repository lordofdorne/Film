import Link from "next/link";

import type { StepView, WalkthroughView } from "../../../src/server/capture.js";
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
export const Hub = ({ walkthrough }: { readonly walkthrough: WalkthroughView }) => {
  const steps = walkthrough.steps;
  const done = steps.filter(isDone);
  const secondsLeft = steps
    .filter((s) => s.required && !isDone(s))
    .reduce((sum, s) => sum + s.estimatedSeconds, 0);

  const name = walkthrough.subject.displayName ?? walkthrough.subject.subjectName;

  const chapters = new Map<string, StepView[]>();
  for (const step of steps) {
    const list = chapters.get(step.chapterId) ?? [];
    list.push(step);
    chapters.set(step.chapterId, list);
  }

  return (
    <main style={styles.page}>
      {/* Thumbnails here are signed URLs with a fifteen-minute life. */}
      <FreshenOnReturn />
      <header style={styles.head}>
        <h1 style={styles.title}>{name === undefined ? "Your film" : `${name}’s film`}</h1>
        <p style={styles.progress}>
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
          <p style={styles.spoken}>
            {spokenSoFar(walkthrough.spokenSecondsSoFar)} of answers recorded
          </p>
        )}
        <div style={styles.track}>
          <div
            style={{
              ...styles.trackFill,
              width: `${String(Math.round((done.length / Math.max(1, steps.length)) * 100))}%`,
            }}
          />
        </div>
      </header>

      {[...chapters.entries()].map(([chapterId, chapterSteps]) => (
        <section key={chapterId} style={styles.chapter}>
          <h2 style={styles.chapterTitle}>{chapterSteps[0]?.chapterTitle}</h2>
          <p style={styles.chapterBlurb}>{chapterSteps[0]?.chapterBlurb}</p>
          <ul style={styles.cards}>
            {chapterSteps.map((step) => (
              <StepCard key={step.id} projectId={walkthrough.projectId} step={step} />
            ))}
          </ul>
        </section>
      ))}

      <footer style={styles.footer}>
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

const isDone = (step: StepView): boolean =>
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
  readonly step: StepView;
}) => {
  const done = isDone(step);
  return (
    <li>
      <Link href={`/projects/${projectId}/step/${step.id}`} style={styles.card}>
        <span style={{ ...styles.mark, ...(done ? styles.markDone : {}) }} aria-hidden>
          {done ? "✓" : "○"}
        </span>
        <span style={styles.cardBody}>
          <span style={{ ...styles.ask, ...(done ? {} : styles.askOpen) }}>{step.ask}</span>
          <span style={styles.note}>
            {!step.required && !done && "optional"}
            {done && step.value !== null && step.value !== "" && String(step.value)}
            {step.qcNote !== undefined && ` · ${step.qcNote}`}
          </span>
        </span>
        {step.asset !== null && (
          <span style={styles.thumbHolder}>
            {step.asset.kind === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed
              // URLs are short-lived and remote patterns would have to be open.
              <img src={step.asset.url} alt="" style={styles.thumb} loading="lazy" />
            ) : (
              <video src={step.asset.url} style={styles.thumb} preload="metadata" muted />
            )}
          </span>
        )}
      </Link>
    </li>
  );
};

const styles = {
  page: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "40px 24px 120px",
    fontFamily: "system-ui, sans-serif",
    color: "#1a1a1a",
  },
  head: { marginBottom: 8 },
  title: { fontSize: 28, fontWeight: 600, letterSpacing: -0.5, margin: 0 },
  progress: { fontSize: 14, color: "#666", margin: "8px 0 0" },
  spoken: { fontSize: 13, color: "#8a8a8a", margin: "4px 0 0" },
  track: { height: 4, background: "#eee", borderRadius: 2, margin: "12px 0 0", overflow: "hidden" },
  trackFill: { height: "100%", background: "#12603a", transition: "width 240ms ease" },
  chapter: { marginTop: 36 },
  chapterTitle: {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    color: "#12603a",
    margin: 0,
  },
  chapterBlurb: { fontSize: 14, lineHeight: 1.6, color: "#666", margin: "6px 0 0" },
  cards: {
    listStyle: "none",
    padding: 0,
    margin: "14px 0 0",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  card: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    border: "1px solid #e4e4e4",
    borderRadius: 10,
    padding: "14px 16px",
    textDecoration: "none",
    color: "inherit",
    background: "#fff",
  },
  mark: { fontSize: 16, color: "#bbb", width: 20, textAlign: "center" as const, flexShrink: 0 },
  markDone: { color: "#12603a", fontWeight: 700 },
  cardBody: { display: "flex", flexDirection: "column" as const, gap: 2, minWidth: 0, flex: 1 },
  ask: { fontSize: 15, lineHeight: 1.4 },
  askOpen: { fontWeight: 600 },
  note: { fontSize: 13, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  thumbHolder: { flexShrink: 0 },
  thumb: {
    width: 56,
    height: 56,
    objectFit: "cover" as const,
    borderRadius: 8,
    background: "#000",
    display: "block",
  },
  footer: {
    position: "sticky" as const,
    bottom: 0,
    marginTop: 40,
    padding: "16px 0 24px",
    background: "linear-gradient(transparent, #fff 30%)",
  },
} as const;
