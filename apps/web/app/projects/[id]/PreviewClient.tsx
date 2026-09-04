"use client";

import { Player } from "@remotion/player";
import { FilmComposition, msToFrame, type FilmProps } from "@film/render/composition";
import { useCallback, useState, useTransition, type ReactNode } from "react";
import { approveEdlVersion } from "../../../src/server/actions.js";
import type { AssetWarning, ProjectSummary } from "../../../src/server/project.js";

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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(summary.approved);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

  const durationInFrames = msToFrame(props.edl.totalDurationMs, props.format.fps);
  const outstanding = summary.warnings.filter((w) => !acknowledged.has(warningKey(w)));

  const acknowledge = useCallback((w: AssetWarning) => {
    setAcknowledged((prev) => new Set(prev).add(warningKey(w)));
  }, []);

  const approve = useCallback(() => {
    setError(null);
    startTransition(async () => {
      // Who is approving, and under which template, is the server's to know.
      const result = await approveEdlVersion(summary.id, summary.edlVersionId);
      if (result.ok) setApproved(true);
      else setError(result.error);
    });
  }, [summary.edlVersionId, summary.id]);

  return (
    <main className="page stack-5">
      <header className="stack">
        <h1 className="title">{summary.subject.subjectName}</h1>
        <p className="muted">
          {summary.templateId}@{String(summary.templateVersion)} · cut v
          {String(summary.edlVersion)} ·{" "}
          {formatDuration(props.edl.totalDurationMs)} · {props.format.width}×
          {props.format.height}
        </p>
      </header>

      {delivery}

      <div className="player-frame">
        <Player
          component={FilmComposition}
          inputProps={props}
          durationInFrames={durationInFrames}
          fps={props.format.fps}
          compositionWidth={props.format.width}
          compositionHeight={props.format.height}
          style={{ width: "100%" }}
          controls
          doubleClickToFullscreen
          acknowledgeRemotionLicense
        />
      </div>

      {/*
        The preview is not acoustically identical to delivery. Final loudness
        mastering happens in FFmpeg after Remotion finishes, so levels here are
        close but not final. Saying so is more honest than letting someone
        conclude the mix is broken.
      */}
      <p className="tiny">
        Picture and timing here are exactly what will be delivered. Audio levels are
        close but not final — the delivered file is mastered to −14 LUFS after rendering.
      </p>

      <section className="card stack-4">
        <h2 className="heading">
          Before you approve
          {outstanding.length > 0 && (
            <span className="badge">{outstanding.length}</span>
          )}
        </h2>

        {summary.warnings.length === 0 ? (
          <p className="muted">No quality warnings were raised on this project.</p>
        ) : (
          <ul className="list">
            {summary.warnings.map((w) => {
              const key = warningKey(w);
              const done = acknowledged.has(key);
              return (
                <li key={key} className={done ? "warning warning--done" : "warning"}>
                  <div>
                    <strong className="warning__label">{w.label}</strong>
                    <span className="warning__text">{w.message}</span>
                  </div>
                  {/* Warnings never block after acknowledgement — they inform. */}
                  <button
                    type="button"
                    onClick={() => { acknowledge(w); }}
                    disabled={done}
                    className="btn btn--secondary"
                  >
                    {done ? "Acknowledged" : "I understand"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card stack-4">
        {approved ? (
          <p className="note note--quiet">
            Approved. This cut is cleared for delivery-quality rendering.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={approve}
              disabled={pending || outstanding.length > 0}
              className="btn btn--primary"
            >
              {pending ? "Approving…" : "Approve this film"}
            </button>
            {outstanding.length > 0 && (
              <p className="muted">
                {outstanding.length} warning{outstanding.length === 1 ? "" : "s"} still to
                read. They will not stop you — you just have to see them first.
              </p>
            )}
            {error !== null && <p className="note note--error">{error}</p>}
          </>
        )}
      </section>
    </main>
  );
};

const warningKey = (w: AssetWarning): string => `${w.assetId}:${w.code}`;

const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
};

