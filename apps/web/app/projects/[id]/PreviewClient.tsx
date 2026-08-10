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
  approverId,
  delivery,
}: {
  readonly summary: ProjectSummary;
  readonly props: FilmProps;
  readonly approverId: string;
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
      const result = await approveEdlVersion(
        summary.id,
        summary.edlVersionId,
        approverId,
        summary.templateId,
        summary.templateVersion,
      );
      if (result.ok) setApproved(true);
      else setError(result.error);
    });
  }, [approverId, summary.edlVersionId, summary.id, summary.templateId, summary.templateVersion]);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{summary.subject.subjectName}</h1>
        <p style={styles.meta}>
          {summary.templateId}@{String(summary.templateVersion)} · cut v
          {String(summary.edlVersion)} ·{" "}
          {formatDuration(props.edl.totalDurationMs)} · {props.format.width}×
          {props.format.height}
        </p>
      </header>

      {delivery}

      <div style={{ ...styles.playerFrame, marginTop: 24 }}>
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
      <p style={styles.note}>
        Picture and timing here are exactly what will be delivered. Audio levels are
        close but not final — the delivered file is mastered to −14 LUFS after rendering.
      </p>

      <section style={styles.panel}>
        <h2 style={styles.h2}>
          Before you approve
          {outstanding.length > 0 && (
            <span style={styles.badge}>{outstanding.length}</span>
          )}
        </h2>

        {summary.warnings.length === 0 ? (
          <p style={styles.muted}>No quality warnings were raised on this project.</p>
        ) : (
          <ul style={styles.list}>
            {summary.warnings.map((w) => {
              const key = warningKey(w);
              const done = acknowledged.has(key);
              return (
                <li key={key} style={{ ...styles.warning, opacity: done ? 0.45 : 1 }}>
                  <div>
                    <strong style={styles.warningLabel}>{w.label}</strong>
                    <span style={styles.warningText}>{w.message}</span>
                  </div>
                  {/* Warnings never block after acknowledgement — they inform. */}
                  <button
                    type="button"
                    onClick={() => { acknowledge(w); }}
                    disabled={done}
                    style={styles.ack}
                  >
                    {done ? "Acknowledged" : "I understand"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={styles.panel}>
        {approved ? (
          <p style={styles.approved}>
            Approved. This cut is cleared for delivery-quality rendering.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={approve}
              disabled={pending || outstanding.length > 0}
              style={{
                ...styles.approve,
                opacity: pending || outstanding.length > 0 ? 0.5 : 1,
              }}
            >
              {pending ? "Approving…" : "Approve this film"}
            </button>
            {outstanding.length > 0 && (
              <p style={styles.muted}>
                {outstanding.length} warning{outstanding.length === 1 ? "" : "s"} still to
                read. They will not stop you — you just have to see them first.
              </p>
            )}
            {error !== null && <p style={styles.error}>{error}</p>}
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

const styles = {
  page: { maxWidth: 980, margin: "0 auto", padding: "32px 24px 96px", fontFamily: "system-ui, sans-serif", color: "#1a1a1a" },
  header: { marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.4 },
  meta: { margin: "6px 0 0", color: "#666", fontSize: 14 },
  playerFrame: { background: "#000", borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" },
  note: { color: "#666", fontSize: 13, margin: "12px 2px 0", lineHeight: 1.5 },
  panel: { marginTop: 32, padding: 20, border: "1px solid #e4e4e4", borderRadius: 10 },
  h2: { fontSize: 16, fontWeight: 600, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 },
  badge: { background: "#b45309", color: "#fff", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontWeight: 600 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 },
  warning: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: 12, background: "#fdf6ec", border: "1px solid #f0dcc0", borderRadius: 8 },
  warningLabel: { display: "block", fontSize: 13, marginBottom: 2 },
  warningText: { fontSize: 13, color: "#5c4a33" },
  ack: { border: "1px solid #c9a26a", background: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" as const },
  approve: { background: "#12603a", color: "#fff", border: "none", borderRadius: 8, padding: "12px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  approved: { margin: 0, color: "#12603a", fontWeight: 600 },
  muted: { color: "#777", fontSize: 13, margin: "10px 0 0" },
  error: { color: "#a11", fontSize: 14, margin: "10px 0 0" },
} as const;
