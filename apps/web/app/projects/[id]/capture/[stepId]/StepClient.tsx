"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { discardStep, finishUpload, mintUploadFor } from "../../../../../src/server/captureActions.js";
import type { StepView } from "../../../../../src/server/capture.js";

/**
 * One step of the walk-through: record it, look at it, do it again, move on.
 *
 * Both ways of giving us something are on every step, always. Some moments
 * have to be captured now — nobody has last year's answer to "what have you
 * learned about love" lying around — and others already exist and only need
 * finding. That difference is about the moment, not the file, so it is not two
 * different screens.
 *
 * Not a single string here is specific to life-advice. Everything the customer
 * reads arrives in `step`, which the template authored.
 */

/** In preference order. Safari records mp4; Chrome and Firefox record webm. */
const VIDEO_TYPES = [
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

const supportedType = (): string | null => {
  if (typeof MediaRecorder === "undefined") return null;
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
};

type Saving = { readonly state: "idle" | "saving" | "saved" | "failed"; readonly error?: string };

export const StepClient = ({
  projectId,
  step,
  previousId,
  nextId,
  totalSteps,
  firstOfChapter,
}: {
  readonly projectId: string;
  readonly step: StepView;
  readonly previousId: string | null;
  readonly nextId: string | null;
  readonly totalSteps: number;
  readonly firstOfChapter: boolean;
}) => {
  const router = useRouter();

  /** What the browser is holding right now, before or instead of a round trip. */
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localIsPhoto, setLocalIsPhoto] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState<Saving>({ state: "idle" });
  const [cameraError, setCameraError] = useState<string | null>(null);

  const liveRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const takesVideo = step.accepts.includes("video");
  const takesPhoto = step.accepts.includes("photo");
  const saved = saving.state === "saved" || (step.asset !== null && saving.state === "idle");

  /** Nothing keeps the camera on after this screen. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => { t.stop(); });
    streamRef.current = null;
    if (liveRef.current !== null) liveRef.current.srcObject = null;
  }, []);

  useEffect(() => stopStream, [stopStream]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => { setSeconds((s) => s + 1); }, 1000);
    return () => { clearInterval(timer); };
  }, [recording]);

  const upload = useCallback(
    async (blob: Blob, contentType: string) => {
      setSaving({ state: "saving" });
      const minted = await mintUploadFor(projectId, step.id, contentType);
      if (!minted.ok) {
        setSaving({ state: "failed", error: minted.error });
        return;
      }
      const { assetId, key, uploadUrl } = minted.mint;

      /**
       * Straight to storage. In production this URL is R2's, signed for one
       * key and one method, and these bytes never touch the app server.
       */
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: blob,
        headers: { "content-type": contentType },
      }).catch(() => null);

      if (put === null || !put.ok) {
        setSaving({ state: "failed", error: "That did not reach us. Try again?" });
        return;
      }

      // The row is written only now, once the bytes are known to have landed.
      const done = await finishUpload(projectId, step.id, assetId, key, contentType);
      setSaving(done.ok ? { state: "saved" } : { state: "failed", error: done.error });
      if (done.ok) router.refresh();
    },
    [projectId, router, step.id],
  );

  const startRecording = useCallback(async () => {
    setCameraError(null);
    const mimeType = supportedType();
    if (mimeType === null) {
      setCameraError("This browser cannot record video. Use “Choose a file” instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
      streamRef.current = stream;
      if (liveRef.current !== null) {
        liveRef.current.srcObject = stream;
        await liveRef.current.play().catch(() => undefined);
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        stopStream();
        setLocalUrl((old) => {
          if (old !== null) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setLocalIsPhoto(false);
        void upload(blob, mimeType);
      };

      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
      recorder.start();
    } catch {
      // Almost always a refused permission, and there is a way round it.
      setCameraError(
        "No camera or microphone available — check the permission, or use “Choose a file”.",
      );
      stopStream();
    }
  }, [stopStream, upload]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const chooseFile = useCallback(
    (file: File | undefined) => {
      if (file === undefined) return;
      setCameraError(null);
      setLocalUrl((old) => {
        if (old !== null) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      setLocalIsPhoto(file.type.startsWith("image/"));
      void upload(file, file.type);
    },
    [upload],
  );

  /**
   * Doing it again is one press, not two.
   *
   * The replacement is uploaded over the top — completeUpload swaps the row and
   * removes the take it replaced — so there is no "delete, then record" dance.
   * Somebody unhappy with an answer they just gave should be recording again
   * before they have time to feel awkward about it.
   */
  const removeCapture = useCallback(() => {
    setLocalUrl((old) => {
      if (old !== null) URL.revokeObjectURL(old);
      return null;
    });
    setSaving({ state: "idle" });
    void discardStep(projectId, step.id).then(() => { router.refresh(); });
  }, [projectId, router, step.id]);

  /** What to show back: this session's capture first, then whatever is stored. */
  const shownUrl = localUrl ?? step.asset?.url ?? null;
  const shownIsPhoto =
    localUrl !== null ? localIsPhoto : step.asset !== null && step.asset.kind === "photo";

  return (
    <main style={styles.page}>
      <header style={styles.head}>
        <span style={styles.chapter}>{step.chapterTitle}</span>
        <span style={styles.counter}>
          Step {step.number} of {totalSteps}
          {!step.required && " · optional"}
        </span>
      </header>
      <div style={styles.track}>
        <div style={{ ...styles.trackFill, width: `${String((step.number / totalSteps) * 100)}%` }} />
      </div>

      {firstOfChapter && <p style={styles.blurb}>{step.chapterBlurb}</p>}

      <h1 style={styles.ask}>{step.ask}</h1>
      {step.coaching !== undefined && <p style={styles.coaching}>{step.coaching}</p>}
      {step.examples !== undefined && step.examples.length > 0 && (
        <ul style={styles.examples}>
          {step.examples.map((example) => (
            <li key={example} style={styles.example}>{example}</li>
          ))}
        </ul>
      )}

      <section style={styles.stage}>
        {recording ? (
          <>
            <video ref={liveRef} muted playsInline style={styles.media} />
            <div style={styles.row}>
              <button type="button" onClick={stopRecording} style={styles.stop}>
                Stop recording
              </button>
              <span style={styles.timer}>{formatSeconds(seconds)}</span>
            </div>
          </>
        ) : shownUrl !== null ? (
          <>
            {shownIsPhoto ? (
              <img src={shownUrl} alt="" style={styles.media} />
            ) : (
              <video src={shownUrl} controls playsInline style={styles.media} />
            )}
            <div style={styles.row}>
              {takesVideo && (
                <button
                  type="button"
                  onClick={() => { void startRecording(); }}
                  style={styles.secondary}
                >
                  Record again
                </button>
              )}
              <label style={styles.secondary}>
                {takesVideo ? "Choose a different file" : "Choose a different photo"}
                <input
                  type="file"
                  accept={acceptAttribute(step)}
                  style={{ display: "none" }}
                  onChange={(event) => { chooseFile(event.target.files?.[0]); }}
                />
              </label>
              {!step.required && (
                <button type="button" onClick={removeCapture} style={styles.remove}>
                  Remove
                </button>
              )}
              <SavingNote saving={saving} saved={saved} />
            </div>
          </>
        ) : (
          <>
            <div style={styles.empty}>
              {takesVideo && takesPhoto
                ? "Record something, or choose a photo or video you already have."
                : takesVideo
                  ? "Record it here, or choose a video you already have."
                  : "Take a photo, or choose one you already have."}
            </div>
            <div style={styles.row}>
              {takesVideo && (
                <button type="button" onClick={() => { void startRecording(); }} style={styles.record}>
                  Record
                </button>
              )}
              <label style={styles.secondary}>
                {takesPhoto && !takesVideo ? "Choose a photo" : "Choose a file"}
                <input
                  type="file"
                  accept={acceptAttribute(step)}
                  style={{ display: "none" }}
                  onChange={(event) => { chooseFile(event.target.files?.[0]); }}
                />
              </label>
            </div>
          </>
        )}
        {cameraError !== null && <p style={styles.error}>{cameraError}</p>}
      </section>

      <nav style={styles.nav}>
        {previousId === null ? (
          <span />
        ) : (
          <a href={`/projects/${projectId}/capture/${previousId}`} style={styles.back}>
            Back
          </a>
        )}
        {nextId === null ? (
          <a href={`/projects/${projectId}/capture/review`} style={styles.next}>
            Review everything
          </a>
        ) : (
          <a
            href={`/projects/${projectId}/capture/${nextId}`}
            style={{
              ...styles.next,
              // Never blocked, only discouraged: a required step left empty is
              // caught at the end, and being trapped on a question someone does
              // not want to answer yet is how people abandon a walk-through.
              opacity: saved || !step.required ? 1 : 0.55,
            }}
          >
            {saved || !step.required ? "Next" : "Skip for now"}
          </a>
        )}
      </nav>
    </main>
  );
};

const SavingNote = ({ saving, saved }: { readonly saving: Saving; readonly saved: boolean }) => {
  if (saving.state === "saving") return <span style={styles.saving}>Saving…</span>;
  if (saving.state === "failed") return <span style={styles.error}>{saving.error}</span>;
  if (saved) return <span style={styles.savedNote}>Saved</span>;
  return null;
};

const acceptAttribute = (step: StepView): string => {
  const parts: string[] = [];
  if (step.accepts.includes("photo")) parts.push("image/*");
  if (step.accepts.includes("video")) parts.push("video/*");
  return parts.join(",");
};

const formatSeconds = (total: number): string =>
  `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;

const styles = {
  page: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "32px 24px 80px",
    fontFamily: "system-ui, sans-serif",
    color: "#1a1a1a",
  },
  head: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  chapter: { fontSize: 13, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase" as const, color: "#12603a" },
  counter: { fontSize: 13, color: "#888" },
  track: { height: 3, background: "#eee", borderRadius: 2, margin: "10px 0 0", overflow: "hidden" },
  trackFill: { height: "100%", background: "#12603a", transition: "width 240ms ease" },
  blurb: { fontSize: 14, lineHeight: 1.6, color: "#666", margin: "18px 0 0", padding: "12px 14px", background: "#f6f6f4", borderRadius: 8 },
  ask: { fontSize: 26, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.4, margin: "24px 0 0" },
  coaching: { fontSize: 16, lineHeight: 1.6, color: "#555", margin: "12px 0 0" },
  examples: { display: "flex", flexWrap: "wrap" as const, gap: 8, listStyle: "none", padding: 0, margin: "14px 0 0" },
  example: { fontSize: 13, color: "#5c4a33", background: "#fdf6ec", border: "1px solid #f0dcc0", borderRadius: 999, padding: "4px 12px" },
  stage: { marginTop: 24 },
  media: { width: "100%", maxHeight: 460, objectFit: "contain" as const, background: "#000", borderRadius: 10, display: "block" },
  empty: {
    border: "1px dashed #d0d0d0",
    borderRadius: 10,
    padding: "40px 24px",
    textAlign: "center" as const,
    color: "#888",
    fontSize: 14,
    lineHeight: 1.6,
  },
  row: { display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" as const },
  record: { background: "#a11", color: "#fff", border: "none", borderRadius: 999, padding: "12px 26px", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  stop: { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 999, padding: "12px 26px", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  secondary: { border: "1px solid #ccc", background: "#fff", borderRadius: 999, padding: "12px 22px", fontSize: 15, cursor: "pointer" },
  remove: { border: "none", background: "none", color: "#888", fontSize: 14, cursor: "pointer", textDecoration: "underline" },
  timer: { fontVariantNumeric: "tabular-nums" as const, color: "#a11", fontWeight: 600 },
  saving: { fontSize: 14, color: "#888" },
  savedNote: { fontSize: 14, color: "#12603a", fontWeight: 600 },
  error: { fontSize: 14, color: "#a11", margin: "10px 0 0" },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 36 },
  back: { color: "#666", textDecoration: "none", fontSize: 15 },
  next: { background: "#12603a", color: "#fff", borderRadius: 8, padding: "12px 26px", fontSize: 15, fontWeight: 600, textDecoration: "none" },
} as const;
