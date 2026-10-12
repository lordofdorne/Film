"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { discardStep, finishUpload, mintUploadFor } from "../../../../../../src/server/captureActions.js";
import type { StepView } from "../../../../../../src/server/capture.js";
import { Button, Chip, Icon, Tip } from "../../../../../../src/ui/index.js";

/**
 * One capture, one screen of the wizard: record it, look at it, do it again,
 * keep it and carry on. Both ways of giving us something are on every step,
 * always — some moments have to be captured now, others already exist and
 * only need finding, and that difference is about the moment, not the file.
 *
 * Keep is the reassurance beat: after a take the screen says it is saved and
 * shows it back, and only then offers the way forward. Skip and Keep go to the
 * same place, which the server worked out.
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

type Saving = {
  readonly state: "idle" | "saving" | "saved" | "failed";
  readonly error?: string;
  /** 0–1 while bytes are going up, when the browser can tell us. */
  readonly progress?: number;
};

/**
 * PUT with upload progress.
 *
 * `fetch` cannot report upload progress, and a take is hundreds of megabytes
 * on a phone connection — "Saving…" with no number for two minutes reads as
 * stuck, and stuck is when people close the tab. XMLHttpRequest can.
 */
const putWithProgress = (
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<boolean> =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => { resolve(xhr.status >= 200 && xhr.status < 300); };
    xhr.onerror = () => { resolve(false); };
    xhr.onabort = () => { resolve(false); };
    xhr.send(body);
  });

export const StepClient = ({
  projectId,
  step,
  nextHref,
}: {
  readonly projectId: string;
  readonly step: StepView;
  /** Where Keep and Skip both lead — worked out on the server. */
  readonly nextHref: string;
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

  // The next screen is known; fetch it now so Keep and Skip feel instant.
  useEffect(() => { router.prefetch(nextHref); }, [router, nextHref]);

  /**
   * Closing the tab mid-upload loses the take, and nothing else on the page
   * can say so in time. The browser's own "leave site?" is the one warning
   * that arrives before it is too late.
   */
  useEffect(() => {
    if (saving.state !== "saving") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); };
  }, [saving.state]);

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
      const landed = await putWithProgress(uploadUrl, blob, signedType, (fraction) => {
        setSaving({ state: "saving", progress: fraction });
      });

      if (!landed) {
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
      setCameraError("This browser cannot record video. Use Upload instead — a video from the camera app works just as well.");
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
        "No camera or microphone available. Check the browser’s permission, or use Upload instead.",
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
      setCameraError("No camera available. Check the browser’s permission, or use Choose a photo instead.");
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
  const captured = shownUrl !== null && live === null;
  const photoOnly = takesPhoto && !takesVideo;

  const fileButton = (label: string) => (
    <label className="ui-btn ui-btn--ghost ui-file">
      <Icon name="upload" size={18} />
      {label}
      <input
        type="file"
        accept={acceptAttribute(step)}
        onChange={(event) => { chooseFile(event.target.files?.[0]); }}
      />
    </label>
  );

  return (
    <>
      <main className="wz-body">
        <p className="eyebrow wz-eyebrow">
          {step.chapterTitle}
          {!step.required && " · optional"}
        </p>
        <h1 className="wz-ask">{step.ask}</h1>

        <section aria-label="Camera">
          {live !== null ? (
            <div className="vf vf--filled">
              {/* autoPlay as well as the effect: whichever wins, the person
                  sees themselves rather than a black rectangle. */}
              <video ref={liveRef} autoPlay muted playsInline className="vf__media vf__media--live" />
              {live === "video" && (
                <span className="vf__badge" aria-live="off">
                  <span className="vf__dot" aria-hidden />
                  {formatSeconds(seconds)}
                </span>
              )}
            </div>
          ) : shownUrl !== null ? (
            <div className="vf vf--filled">
              {shownIsPhoto ? (
                <img src={shownUrl} alt="What you added for this step" className="vf__media" />
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
                  className="vf__media"
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
            </div>
          ) : (
            <div className={photoOnly ? "vf vf--light" : "vf"}>
              {!photoOnly && <span className="vf__frame" aria-hidden />}
              <Icon name={photoOnly ? "photo" : "video"} size={36} className="vf__icon" />
              <p className="vf__hint">
                {takesVideo && takesPhoto
                  ? "Record something, or add a photo or video you already have."
                  : takesVideo
                    ? "Record it here, or upload a video you already have."
                    : "Take a photo, or choose one you already have."}
              </p>
            </div>
          )}
        </section>

        {captured && <Reassurance saving={saving} saved={saved} />}
        {cameraError !== null && (
          <p className="note note--error" role="alert">
            {cameraError}
          </p>
        )}
        {step.qcNote !== undefined && saving.state !== "saving" && (
          <p className="note note--warn">{step.qcNote}</p>
        )}
        {step.coaching !== undefined && <Tip>{step.coaching}</Tip>}
        {step.examples !== undefined && step.examples.length > 0 && (
          <div className="wz-examples" aria-label="Ideas">
            {step.examples.map((example) => (
              <Chip key={example}>{example}</Chip>
            ))}
          </div>
        )}
      </main>

      <footer className="wz-foot">
        {live === "video" ? (
          <div className="wz-foot__row">
            <Button size="lg" variant="secondary" block onClick={stopRecording}>
              <span className="vf__dot" aria-hidden />
              Stop recording · {formatSeconds(seconds)}
            </Button>
          </div>
        ) : live === "photo" ? (
          <div className="wz-foot__row">
            <Button variant="quiet" onClick={cancelCamera}>
              Cancel
            </Button>
            <Button size="lg" onClick={takePhoto}>
              <Icon name="camera" size={18} />
              Take the photo
            </Button>
          </div>
        ) : captured ? (
          /* Secondary actions in one row, the way forward full width under
             them: on a phone, a thumb finds the bottom of the screen. */
          <div className="wz-foot__row wz-foot__row--stack">
            <div className="wz-foot__secondary">
              {takesVideo && (
                <Button variant="ghost" onClick={() => { void startRecording(); }}>
                  <Icon name="rotate" size={18} />
                  Again
                </Button>
              )}
              {takesPhoto && (
                <Button variant="ghost" onClick={() => { void startPhoto(); }}>
                  <Icon name="camera" size={18} />
                  {takesVideo ? "Photo" : "Retake"}
                </Button>
              )}
              {fileButton("Replace")}
              {!step.required && (
                <Button variant="quiet" onClick={removeCapture}>
                  Remove
                </Button>
              )}
            </div>
            <Button
              size="lg"
              block
              disabled={saving.state === "saving" || saving.state === "failed"}
              onClick={() => { router.push(nextHref); }}
            >
              {saving.state === "saving"
                ? `Saving${saving.progress === undefined ? "…" : ` ${String(Math.round(saving.progress * 100))}%`}`
                : "Keep and continue"}
              {saving.state !== "saving" && <Icon name="forward" size={18} />}
            </Button>
          </div>
        ) : (
          <div className="wz-foot__row wz-foot__row--stack">
            <div className="wz-foot__secondary">
              <Button variant="quiet" asChild>
                <Link href={nextHref}>Skip for now</Link>
              </Button>
              <span className="wz-foot__group">
                {takesVideo && takesPhoto && (
                  <Button variant="ghost" onClick={() => { void startPhoto(); }}>
                    <Icon name="camera" size={18} />
                    Photo
                  </Button>
                )}
                {fileButton(photoOnly ? "Choose a photo" : "Upload")}
              </span>
            </div>
            {takesVideo ? (
              <Button size="lg" block onClick={() => { void startRecording(); }}>
                <span className="ui-rec-dot" aria-hidden />
                Record
              </Button>
            ) : (
              <Button size="lg" block onClick={() => { void startPhoto(); }}>
                <Icon name="camera" size={18} />
                Take a photo
              </Button>
            )}
          </div>
        )}
      </footer>
    </>
  );
};

/**
 * The reassurance after a take — the first of the three things the owner
 * asked capture to feel like. Said plainly, as soon as the bytes have landed,
 * and with the one thing people worry about answered: it is kept.
 */
const Reassurance = ({ saving, saved }: { readonly saving: Saving; readonly saved: boolean }) => {
  if (saving.state === "saving") {
    const percent = saving.progress === undefined ? null : Math.round(saving.progress * 100);
    return (
      <div className="wz-uploading" role="status">
        <p>
          {percent === null || percent >= 100 ? "Saving" : `Saving — ${String(percent)}%`}
          <span className="muted"> · keep this page open until it is done</span>
        </p>
        <span className="wz-uploading__track" aria-hidden>
          <span className="wz-uploading__fill" style={{ width: `${String(percent ?? 8)}%` }} />
        </span>
      </div>
    );
  }
  if (saving.state === "failed") {
    return (
      <p className="note note--error" role="alert">
        {saving.error} Your recording is still here — try saving it again with Replace, or
        record it once more.
      </p>
    );
  }
  if (!saved) return null;
  return (
    <div className="wz-saved" role="status">
      <Icon name="check" size={22} strokeWidth={2.4} />
      <p className="wz-saved__text">
        Got it — that is saved.
        <span>Watch it back if you like, or carry on. You can always come back to it.</span>
      </p>
    </div>
  );
};

const acceptAttribute = (step: StepView): string => {
  const parts: string[] = [];
  if (step.accepts.includes("photo")) parts.push("image/*");
  if (step.accepts.includes("video")) parts.push("video/*");
  return parts.join(",");
};

const formatSeconds = (total: number): string =>
  `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;

