"use client";

import type { FilmProps } from "@film/render/composition";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition, type ReactNode } from "react";
import { approveEdlVersion } from "../../../src/server/actions.js";
import type { AssetWarning, ProjectSummary } from "../../../src/server/project.js";
import { Button, Chip, Icon, Notice, Skeleton } from "../../../src/ui/index.js";
import { FittedAnswers } from "./FittedAnswers.js";

/**
 * The player, fetched only when there is a film to play.
 *
 * Remotion's player and the composition are most of this page's JavaScript —
 * about 100 KB, measured — and the same URL is the capture overview for the
 * whole of capture, which never draws a frame. Split out, the overview stops
 * paying for it, and the preview draws a placeholder of exactly the player's
 * shape until it lands, so nothing below it moves.
 *
 * `ssr: false` because the player measures its container and starts a
 * timeline: there is nothing useful to render on the server.
 */
const FilmPlayer = dynamic(() => import("./FilmPlayer.js").then((m) => m.FilmPlayer), {
  ssr: false,
  loading: () => <Skeleton height="100%" className="player-frame__placeholder" />,
});

/**
 * The preview is the SAME composition the render worker uses.
 *
 * Not a mock-up of it, not a second implementation — the identical React tree,
 * given the identical EDL. Everything the customer approves here is what gets
 * rendered: timing, framing, captions, transitions, ducking. Only media
 * playback differs, because a browser plays video and a worker extracts frames.
 */
export const PreviewClient = ({
  summary,
  props,
  delivery,
}: {
  readonly summary: ProjectSummary;
  readonly props: FilmProps;
  /**
   * The delivery panel, rendered by the server page and passed through.
   *
   * A node rather than a prop object: this component is the preview, and
   * giving it the delivery state to interpret would make it two things. It
   * only decides where the panel sits, which is above the player — once the
   * film is finished, downloading it is what the page is for.
   */
  readonly delivery: ReactNode;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(summary.approved);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

  const outstanding = summary.warnings.filter((w) => !acknowledged.has(warningKey(w)));

  const acknowledge = useCallback((w: AssetWarning) => {
    setAcknowledged((prev) => new Set(prev).add(warningKey(w)));
  }, []);

  const approve = useCallback(() => {
    setError(null);
    startTransition(async () => {
      // Who is approving, and under which template, is the server's to know.
      const result = await approveEdlVersion(summary.id, summary.edlVersionId);
      if (result.ok) {
        setApproved(true);
        // The server now has a render to report on; the delivery panel it
        // draws replaces the note below as soon as the page re-renders.
        router.refresh();
      } else setError(result.error);
    });
  }, [router, summary.edlVersionId, summary.id]);

  const name = summary.subject.displayName ?? summary.subject.subjectName;

  return (
    <main className="page film-page">
      <header className="film-page__head">
        <p className="eyebrow">{approved ? "Your film" : "Your first cut"}</p>
        <h1 className="display">{name}’s film</h1>
        <div className="row">
          <Chip>
            <Icon name="clock" size={14} />
            {formatDuration(props.edl.totalDurationMs)}
          </Chip>
          {approved ? <Chip tone="success">Approved</Chip> : <Chip tone="accent">Waiting for you</Chip>}
        </div>
      </header>

      {approved && !summary.approved ? (
        <Notice tone="success" title="Approved">
          We are making the full-quality film now. It usually takes a few minutes.
        </Notice>
      ) : (
        delivery
      )}

      <div
        className="player-frame"
        style={{ aspectRatio: `${String(props.format.width)} / ${String(props.format.height)}` }}
      >
        <FilmPlayer props={props} />
      </div>

      {/*
        The preview is not acoustically identical to delivery. Final loudness
        mastering happens in FFmpeg after Remotion finishes, so levels here are
        close but not final. Saying so is more honest than letting someone
        conclude the mix is broken.
      */}
      <p className="tiny">
        Picture and timing are exactly what you will get. Sound levels are evened out in the
        final file, so they may differ a little from what you hear here.
      </p>

      {!approved && (
        <div className="film-page__review">
          {summary.warnings.length > 0 && (
            <section className="ui-card stack-4" aria-labelledby="warnings-title">
              <div>
                <h2 id="warnings-title" className="heading">
                  Worth knowing before you approve
                  {outstanding.length > 0 && <span className="badge">{outstanding.length}</span>}
                </h2>
                <p className="muted">These never stop you — you just have to see them first.</p>
              </div>
              <ul className="list film-warnings">
                {summary.warnings.map((w) => {
                  const key = warningKey(w);
                  const done = acknowledged.has(key);
                  return (
                    <li key={key} className={done ? "film-warning film-warning--done" : "film-warning"}>
                      <Icon name={done ? "check" : "alert"} size={20} className="film-warning__icon" />
                      <div className="film-warning__text">
                        <strong>{w.label}</strong>
                        <span>{w.message}</span>
                      </div>
                      <Button
                        variant={done ? "quiet" : "ghost"}
                        onClick={() => { acknowledge(w); }}
                        disabled={done}
                      >
                        {done ? "Seen" : "Got it"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <FittedAnswers fitted={summary.fitted} />

          <section className="ui-card film-approve" aria-labelledby="approve-title">
            <div>
              <h2 id="approve-title" className="title">Happy with it?</h2>
              <p className="muted">
                Approving makes the full-quality film for you to download. It takes a few
                minutes, and you can close the page while it does.
              </p>
            </div>
            <Button size="lg" onClick={approve} disabled={pending || outstanding.length > 0}>
              {pending ? "Approving…" : "Approve and make my film"}
            </Button>
            {outstanding.length > 0 && (
              <p className="tiny">
                {outstanding.length === 1 ? "One note" : `${String(outstanding.length)} notes`} above
                still to read first.
              </p>
            )}
            {error !== null && <Notice tone="error">{error}</Notice>}
          </section>
        </div>
      )}
    </main>
  );
};

const warningKey = (w: AssetWarning): string => `${w.assetId}:${w.code}`;

const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
};

