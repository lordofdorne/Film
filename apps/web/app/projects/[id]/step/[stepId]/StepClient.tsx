"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { discardStep, finishUpload, mintUploadFor } from "../../../../../src/server/captureActions.js";
import type { StepView } from "../../../../../src/server/capture.js";

/**
 * One capture, opened from the hub: record it, look at it, do it again, go
 * back. Both ways of giving us something are on every step, always — some
 * moments have to be captured now, others already exist and only need
 * finding, and that difference is about the moment, not the file.
 *
 * No Next, no counter. The hub is the map; finishing here is walking back to
 * it with the card ticked.
 *
 * Not a single string here is specific to one film type. Everything the
 * customer reads arrives in `step`, which the template authored.
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
}: {
  readonly projectId: string;
  readonly step: StepView;
}) => {
  const router = useRouter();

  /** What the browser is holding right now, before or instead of a round trip. */
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localIsPhoto, setLocalIsPhoto] = useState(false);
  /**
   * Whether the camera is on, and what for.
   *
   * One state rather than two booleans because the live `<video>` is one
   * element serving both — a step that takes a photograph frames it exactly
   * the way a step that takes a take does.
   */
  const [live, setLive] = useState<null | "video" | "photo">(null);
  const recording = live === "video";
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

  /**
   * Show the person what the camera can see.
   *
   * This has to be an effect, and that is the whole bug it fixes. The live
   * `<video>` is only mounted while the camera is on, so the old code —
   * which assigned `srcObject` inside startRecording, before flipping the
   * state that mounts the element — was always assigning to a ref that was
   * still null. The recording worked and the preview was a black rectangle,
   * which is a horrible thing to hand somebody who is about to interview
   * their grandmother.
   *
   * Running after the element exists is what makes it appear at all.
   */
  useEffect(() => {
    const video = liveRef.current;
    const stream = streamRef.current;
    if (live === null || video === null || stream === null) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [live]);

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
      const { assetId, key, uploadUrl, contentType: signedType } = minted.mint;

      /**
       * Straight to storage. In production this URL is R2's, signed for one
       * key and one method, and these bytes never touch the app server.
       *
       * The header is the type the URL was SIGNED for, not the one the blob
       * happens to carry. R2 covers content-type in the signature and
       * MediaRecorder hands us `video/webm;codecs=vp9,opus`, so sending the
       * blob's own type would be a 403 on every recording — and one that
       * local development cannot reproduce, because the local upload route
       * does not check a signature at all.
       */
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: blob,
        headers: { "content-type": signedType },
      }).catch(() => null);

      if (put === null || !put.ok) {
        setSaving({ state: "failed", error: "That did not reach us. Try again?" });
        return;
      }

      // The row is written only now, once the bytes are known to have landed.
      const done = await finishUpload(projectId, step.id, assetId, key, signedType);
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
      setLive("video");
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
    setLive(null);
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  /**
   * A photograph, taken here.
   *
   * "Choose a photo" was the only way to give us one, which assumes the
   * picture already exists — and half of them do not. Somebody sitting with a
   * shoebox of prints wants to point a camera at one now, and a phone is a
   * better scanner than anything else in the house. No audio: a still needs
   * no microphone, and asking for one is a permission prompt that frightens
   * people for nothing.
   */
  const startPhoto = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 2560 },
          height: { ideal: 1920 },
          // The back camera on a phone, where there is one. A soft constraint,
          // so a laptop with one camera gets that instead of an error.
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });
      streamRef.current = stream;
      setLive("photo");
    } catch {
      setCameraError("No camera available — check the permission, or use “Choose a photo”.");
      stopStream();
    }
  }, [stopStream]);

  /** Freeze the frame that is on screen, and send that. */
  const takePhoto = useCallback(() => {
    const video = liveRef.current;
    if (video === null) return;

    // Zero until the first frame has arrived. Pressing the button that fast is
    // rare and the fix is to wait a moment, so say so rather than storing a
    // black rectangle.
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError("The camera is still waking up — try that again in a second.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (blob === null) return;
        stopStream();
        setLive(null);
        setLocalUrl((old) => {
          if (old !== null) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setLocalIsPhoto(true);
        void upload(blob, "image/jpeg");
      },
      "image/jpeg",
      // Ingest re-encodes anyway; this only has to survive that without
      // adding artefacts of its own.
      0.92,
    );
  }, [stopStream, upload]);

  /** Changed their mind with the camera open. */
  const cancelCamera = useCallback(() => {
    stopStream();
    setLive(null);
  }, [stopStream]);

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
   * Doing it again is one press, not two. The replacement uploads over the
   * top — the server swaps the row and removes the take it replaced — so there
   * is no "delete, then record" dance.
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
        {!step.required && <span style={styles.counter}>optional</span>}
      </header>

      <h1 style={styles.ask}>{step.ask}</h1>
      {step.coaching !== undefined && <p style={styles.coaching}>{step.coaching}</p>}
      {step.examples !== undefined && step.examples.length > 0 && (
        <ul style={styles.examples}>
          {step.examples.map((example) => (
            <li key={example} style={styles.example}>{example}</li>
          ))}
        </ul>
      )}
      {step.qcNote !== undefined && <p style={styles.qcNote}>{step.qcNote}</p>}

      <section style={styles.stage}>
        {live !== null ? (
          <>
            {/* autoPlay as well as the effect: whichever wins, the person
                sees themselves rather than a black rectangle. */}
            <video ref={liveRef} autoPlay muted playsInline style={styles.media} />
            <div style={styles.row}>
              {live === "video" ? (
                <>
                  <button type="button" onClick={stopRecording} style={styles.stop}>
                    Stop recording
                  </button>
                  <span style={styles.timer}>{formatSeconds(seconds)}</span>
                </>
              ) : (
                <>
                  <button type="button" onClick={takePhoto} style={styles.record}>
                    Take the photo
                  </button>
                  <button type="button" onClick={cancelCamera} style={styles.secondary}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          </>
        ) : shownUrl !== null ? (
          <>
            {shownIsPhoto ? (
              <img src={shownUrl} alt="" style={styles.media} />
            ) : (
              /*
                Nothing is fetched until somebody presses play.

                A take is hundreds of megabytes, and the default preload starts
                pulling it the moment this page renders — so opening a step to
                re-read the question cost a download of the answer. The poster
                is the thumbnail: one small image, and the frame it shows is
                the frame play would have started on anyway.

                `localUrl` is this session's own blob, already in memory, so it
                needs neither.
              */
              <video
                src={shownUrl}
                controls
                playsInline
                style={styles.media}
                {...(localUrl === null
                  ? {
                      preload: "none" as const,
                      ...(step.asset?.thumbUrl === undefined
                        ? {}
                        : { poster: step.asset.thumbUrl }),
                    }
                  : {})}
              />
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
              {takesPhoto && (
                <button
                  type="button"
                  onClick={() => { void startPhoto(); }}
                  style={styles.secondary}
                >
                  {takesVideo ? "Take a photo" : "Take another photo"}
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
              {takesPhoto && (
                <button
                  type="button"
                  onClick={() => { void startPhoto(); }}
                  style={takesVideo ? styles.secondary : styles.record}
                >
                  Take a photo
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
        <Link
          href={`/projects/${projectId}`}
          style={saved ? styles.done : styles.back}
        >
          {saved ? "Done — back to the film" : "Back to the film"}
        </Link>
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
  ask: { fontSize: 26, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.4, margin: "20px 0 0" },
  coaching: { fontSize: 16, lineHeight: 1.6, color: "#555", margin: "12px 0 0" },
  examples: { display: "flex", flexWrap: "wrap" as const, gap: 8, listStyle: "none", padding: 0, margin: "14px 0 0" },
  example: { fontSize: 13, color: "#5c4a33", background: "#fdf6ec", border: "1px solid #f0dcc0", borderRadius: 999, padding: "4px 12px" },
  qcNote: { fontSize: 14, lineHeight: 1.5, color: "#7a4a12", background: "#fdf3e4", border: "1px solid #f0d6ae", borderRadius: 8, padding: "10px 12px", margin: "14px 0 0" },
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
  nav: { display: "flex", justifyContent: "flex-start", marginTop: 36 },
  back: { color: "#666", textDecoration: "none", fontSize: 15 },
  done: { background: "#12603a", color: "#fff", borderRadius: 8, padding: "12px 26px", fontSize: 15, fontWeight: 600, textDecoration: "none" },
} as const;
