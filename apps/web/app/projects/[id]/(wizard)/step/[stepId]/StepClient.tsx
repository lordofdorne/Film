"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { discardStep } from "../../../../../../src/server/captureActions.js";
import { clock, spokenRange, takeZone, type TakeLength } from "@film/templates/take";

import type { StepView } from "../../../../../../src/server/capture.js";
import { useCamera, useUpload, useUploads, type UploadState } from "../../../CaptureProvider.js";
import { usePrefetchNext } from "../../usePrefetchNext.js";
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

/**
 * How big a take is allowed to get.
 *
 * Left to itself the browser picks, and Safari's 1080p is generous: an
 * answer was hundreds of megabytes, which is minutes of upload on a phone.
 * Five megabits is well above what ingest keeps (1080p at CRF 20) and about
 * 37 MB a minute. One-second chunks so a long take is never held as one piece.
 */
const VIDEO_BITS_PER_SECOND = 5_000_000;
const AUDIO_BITS_PER_SECOND = 128_000;
const CHUNK_MS = 1_000;

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
  const camera = useCamera();
  /**
   * The camera's functions, not the camera: they keep one identity for the
   * life of the film, so the handlers below are built once per step rather
   * than again whenever the stream changes.
   */
  const { acquire, letGo, stop: stopCamera } = camera;
  const { enqueue, retry, cancel } = useUploads();
  // This step's take only: another step's progress does not re-render this one.
  const upload = useUpload(step.id);

  /**
   * What the screen is doing with the camera.
   *
   *   idle      — nothing live: the invitation, or what was captured
   *   preview   — the camera is on and the person can see themselves
   *   recording — and it counts
   *   photo     — the back camera, framing a still
   */
  const [phase, setPhase] = useState<"idle" | "preview" | "recording" | "photo">("idle");
  const recording = phase === "recording";
  const [seconds, setSeconds] = useState(0);
  /** When this recording started, so the clock is measured, not counted. */
  const startedAtRef = useRef(0);
  /** The take just recorded, for what is said about its length. */
  const [lastTake, setLastTake] = useState<{ seconds: number; atMax: boolean } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const liveRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const takesVideo = step.accepts.includes("video");
  const takesPhoto = step.accepts.includes("photo");
  const photoOnly = takesPhoto && !takesVideo;

  /** This browser's own copy first — it is the newest — then what is stored. */
  const shownUrl = upload?.localUrl ?? step.asset?.url ?? null;
  const shownIsPhoto = upload !== undefined ? upload.isPhoto : step.asset?.kind === "photo";
  const captured = shownUrl !== null && phase === "idle";

  // The next screen is known; fetch it now so Keep and Skip feel instant.
  usePrefetchNext(nextHref);

  /**
   * The camera, on as soon as the screen is up — once it has been allowed.
   *
   * The first recording step of a visit asks: "Turn on the camera" is a
   * button, because a permission prompt nobody asked for is alarming. After
   * that every recording step opens with the person already on screen, so
   * Record starts in the same instant it is pressed, and they can see how they
   * are framed before it counts. A step that already has a take shows the take.
   */
  const openPreview = useCallback(async () => {
    setCameraError(null);
    try {
      await acquire("video");
      setPhase("preview");
    } catch {
      // Almost always a refused permission, and there is a way round it.
      setCameraError(
        "No camera or microphone available. Check the browser’s permission, or use Upload instead.",
      );
      setPhase("idle");
    }
  }, [acquire]);

  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !takesVideo || shownUrl !== null || !camera.allowed) return;
    autoOpened.current = true;
    void openPreview();
  }, [takesVideo, shownUrl, camera.allowed, openPreview]);

  // Leaving the screen lets the camera go; the next question picks it up.
  useEffect(() => letGo, [letGo]);

  /**
   * Show the person what the camera sees, on whichever element is up.
   *
   * An effect, because the live `<video>` only exists once the phase that
   * mounts it has rendered — assigning before then put the stream on a null
   * ref, and the preview was a black rectangle.
   */
  useEffect(() => {
    const video = liveRef.current;
    if (phase === "idle" || video === null || camera.stream === null) return;
    if (video.srcObject !== camera.stream) video.srcObject = camera.stream;
    void video.play().catch(() => undefined);
  }, [phase, camera.stream]);

  // The camera went away under the screen (the tab was hidden): say so by
  // going back to the invitation, rather than showing a frozen frame.
  useEffect(() => {
    if (camera.stream === null && (phase === "preview" || phase === "photo")) setPhase("idle");
  }, [camera.stream, phase]);

  /**
   * The recording clock, read from when it started rather than counted.
   *
   * A once-a-second interval drifts, and a phone delays timers when it is
   * busy — which is exactly while it is recording. Measuring from the start
   * four times a second keeps the timer and the auto-stop honest.
   */
  useEffect(() => {
    if (!recording) return;
    const tick = () => { setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)); };
    const timer = setInterval(tick, 250);
    return () => { clearInterval(timer); };
  }, [recording]);

  const startRecording = useCallback(async () => {
    setCameraError(null);
    const mimeType = supportedType();
    if (mimeType === null) {
      setCameraError("This browser cannot record video. Use Upload instead — a video from the camera app works just as well.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await acquire("video");
    } catch {
      setCameraError(
        "No camera or microphone available. Check the browser’s permission, or use Upload instead.",
      );
      return;
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    /**
     * The take is handed to the queue and the screen is free. It goes up
     * behind the person while they read the next question; the camera stays
     * with the provider, so the next question finds it on.
     */
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size > 0) enqueue(step.id, blob, mimeType, false);
      setPhase("idle");
      letGo();
    };

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setSeconds(0);
    setLastTake(null);
    setPhase("recording");
    recorder.start(CHUNK_MS);
  }, [acquire, enqueue, letGo, step.id]);

  const stopRecording = useCallback((atMax = false) => {
    setLastTake({ seconds: (Date.now() - startedAtRef.current) / 1000, atMax });
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder !== null && recorder.state !== "inactive") recorder.stop();
    else setPhase("idle");
  }, []);

  // Recording when the camera goes (the tab was hidden): keep what there is.
  useEffect(() => {
    if (recording && camera.stream === null) stopRecording();
  }, [recording, camera.stream, stopRecording]);

  /**
   * The longest this answer can use, and then it stops by itself.
   *
   * Asked for by the owner: a take that runs past what the film can hold is
   * cut where it would be cut anyway, and saying so beforehand — the timer
   * counts down for the last fifteen seconds — means nobody is cut off by
   * surprise. Everything recorded up to here is kept.
   */
  const take = step.take;
  useEffect(() => {
    if (recording && take !== undefined && seconds >= take.max) stopRecording(true);
  }, [recording, take, seconds, stopRecording]);

  /**
   * A photograph, taken here.
   *
   * "Choose a photo" was the only way to give us one, which assumes the
   * picture already exists — and half of them do not. Somebody sitting with a
   * shoebox of prints wants to point a camera at one now, and a phone is a
   * better scanner than anything else in the house.
   */
  const startPhoto = useCallback(async () => {
    setCameraError(null);
    try {
      await acquire("photo");
      setPhase("photo");
    } catch {
      setCameraError("No camera available. Check the browser’s permission, or use Choose a photo instead.");
    }
  }, [acquire]);

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
        // The back camera goes off as soon as it has done its job.
        stopCamera();
        setPhase("idle");
        enqueue(step.id, blob, "image/jpeg", true);
      },
      "image/jpeg",
      // Ingest re-encodes anyway; this only has to survive that without
      // adding artefacts of its own.
      0.92,
    );
  }, [enqueue, step.id, stopCamera]);

  /** Changed their mind with the camera open. */
  const cancelCamera = useCallback(() => {
    if (phase === "photo") stopCamera();
    else letGo();
    setPhase("idle");
  }, [letGo, phase, stopCamera]);

  const chooseFile = useCallback(
    (file: File | undefined) => {
      if (file === undefined) return;
      setCameraError(null);
      setLastTake(null);
      setPhase("idle");
      letGo();
      enqueue(step.id, file, file.type, file.type.startsWith("image/"));
    },
    [enqueue, letGo, step.id],
  );

  /**
   * Doing it again is one press, not two. A new take goes over the top — the
   * server swaps the row and removes the one it replaced — so there is no
   * "delete, then record" dance. Remove forgets any take still on its way.
   */
  const removeCapture = useCallback(() => {
    setLastTake(null);
    cancel(step.id);
    void discardStep(projectId, step.id).then(() => { router.refresh(); });
  }, [cancel, projectId, router, step.id]);

  const retryUpload = useCallback(() => { retry(step.id); }, [retry, step.id]);

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

  const live = phase !== "idle";

  return (
    <>
      <main className="wz-body">
        <p className="eyebrow wz-eyebrow">
          {step.chapterTitle}
          {!step.required && " · optional"}
        </p>
        <h1 className="wz-ask">{step.ask}</h1>

        <section aria-label="Camera">
          {live ? (
            <div className="vf vf--filled">
              {/* autoPlay as well as the effect: whichever wins, the person
                  sees themselves rather than a black rectangle. */}
              <video ref={liveRef} autoPlay muted playsInline className="vf__media vf__media--live" />
              {recording &&
                (take === undefined ? (
                  <span className="vf__badge" aria-live="off">
                    <span className="vf__dot" aria-hidden />
                    {clock(seconds)}
                  </span>
                ) : (
                  <TakeTimer seconds={seconds} take={take} />
                ))}
              {phase === "preview" && take !== undefined && (
                <span className="vf__badge vf__badge--quiet">A good length is {spokenRange(take)}</span>
              )}
            </div>
          ) : shownUrl !== null ? (
            <div className="vf vf--filled">
              {shownIsPhoto ? (
                <img src={shownUrl} alt="What you added for this step" className="vf__media" />
              ) : (
                /*
                  Nothing is fetched until somebody presses play.

                  A take is tens of megabytes, and the default preload starts
                  pulling it the moment this page renders — so opening a step to
                  re-read the question cost a download of the answer. The poster
                  is the thumbnail. This browser's own copy is already in
                  memory, so it needs neither.
                */
                <video
                  src={shownUrl}
                  controls
                  playsInline
                  className="vf__media"
                  {...(upload === undefined
                    ? {
                        preload: "none" as const,
                        ...(step.asset?.thumbUrl === undefined ? {} : { poster: step.asset.thumbUrl }),
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
                    ? "Turn on the camera to see how you are framed, then record."
                    : "Take a photo, or choose one you already have."}
              </p>
              {take !== undefined && takesVideo && (
                <p className="vf__aim">A good length is {spokenRange(take)}.</p>
              )}
            </div>
          )}
        </section>

        {captured && lastTake !== null && upload !== undefined && !upload.isPhoto && take !== undefined && (
          <TakeNote seconds={lastTake.seconds} atMax={lastTake.atMax} take={take} />
        )}
        {captured && (
          <Reassurance
            upload={upload}
            stored={step.asset !== null}
            onRetry={retryUpload}
          />
        )}
        {cameraError !== null && (
          <p className="note note--error" role="alert">
            {cameraError}
          </p>
        )}
        {step.qcNote !== undefined && upload === undefined && (
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
        {phase === "recording" ? (
          <div className="wz-foot__row">
            <Button size="lg" variant="secondary" block onClick={() => { stopRecording(); }}>
              <span className="vf__dot" aria-hidden />
              Stop recording · {clock(seconds)}
            </Button>
          </div>
        ) : phase === "photo" ? (
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
             them: on a phone, a thumb finds the bottom of the screen. Keep
             never waits for the upload — the queue has it. */
          <div className="wz-foot__row wz-foot__row--stack">
            <div className="wz-foot__secondary">
              {takesVideo && (
                <Button variant="ghost" onClick={() => { void openPreview(); }}>
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
            {/* A link, like Skip: the tap is seen the moment it lands. */}
            <Button size="lg" block asChild>
              <Link href={nextHref}>
                Keep and continue
                <Icon name="forward" size={18} />
              </Link>
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
            {!takesVideo ? (
              <Button size="lg" block onClick={() => { void startPhoto(); }}>
                <Icon name="camera" size={18} />
                Take a photo
              </Button>
            ) : phase === "preview" ? (
              <Button size="lg" block onClick={() => { void startRecording(); }}>
                <span className="ui-rec-dot" aria-hidden />
                Record
              </Button>
            ) : (
              <Button size="lg" block onClick={() => { void openPreview(); }}>
                <Icon name="video" size={18} />
                Turn on the camera
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
 * asked capture to feel like. Said plainly, and with the one thing people
 * worry about answered: it is kept. While the take is still going up, it
 * says that too, and that they need not wait for it.
 */
const Reassurance = memo(function Reassurance({
  upload,
  stored,
  onRetry,
}: {
  readonly upload: UploadState | undefined;
  readonly stored: boolean;
  readonly onRetry: () => void;
}) {
  if (upload !== undefined && (upload.state === "queued" || upload.state === "saving")) {
    const percent =
      upload.state === "saving" && upload.progress !== undefined ? Math.round(upload.progress * 100) : null;
    return (
      <div className="wz-uploading" role="status">
        <p>
          {percent === null || percent >= 100 ? "Saving" : `Saving — ${String(percent)}%`}
          <span className="muted"> · carry on whenever you like; it keeps going</span>
        </p>
        <span className="wz-uploading__track" aria-hidden>
          <span className="wz-uploading__fill" style={{ width: `${String(percent ?? 8)}%` }} />
        </span>
      </div>
    );
  }
  if (upload !== undefined && upload.state === "failed") {
    return (
      <div className="note note--error" role="alert">
        That one did not save — the connection dropped. Your recording is still here.{" "}
        <button type="button" className="linklike" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (!stored && upload?.state !== "saved") return null;
  return (
    <div className="wz-saved" role="status">
      <Icon name="check" size={22} strokeWidth={2.4} />
      <p className="wz-saved__text">
        Got it — that is saved.
        <span>Watch it back if you like, or carry on. You can always come back to it.</span>
      </p>
    </div>
  );
});

/**
 * The clock while recording, drawn across the bottom of the picture: how long
 * so far, where the good range is, and what to do about it.
 *
 * The words change only when the zone does — "aim for", then "good length,
 * stop when ready", then "plenty" — so a screen reader hears four short
 * sentences, not a second-by-second count. Short enough for one line on a
 * phone. The last fifteen seconds count
 * down on screen, and say once that it will stop by itself.
 */
const TakeTimer = ({ seconds, take }: { readonly seconds: number; readonly take: TakeLength }) => {
  const zone = takeZone(seconds, take);
  const at = (s: number): string => `${String((Math.min(s, take.max) / take.max) * 100)}%`;
  const said =
    zone === "short"
      ? `Aim for ${spokenRange(take)}`
      : zone === "good"
        ? "Good length · stop when ready"
        : zone === "plenty"
          ? "Plenty · wrap up when ready"
          : "It will stop by itself soon";

  return (
    <div className={`take take--${zone}`}>
      <div className="take__row">
        <span className="take__clock">
          <span className="vf__dot" aria-hidden />
          {clock(seconds)}
        </span>
        <span className="take__said" aria-live="polite">
          {zone === "good" && <Icon name="check" size={16} strokeWidth={2.6} />}
          {zone === "ending" ? `Stops in ${clock(take.max - seconds)}` : said}
        </span>
      </div>
      <span className="take__track" aria-hidden>
        <span className="take__good" style={{ left: at(take.goodFrom), width: at(take.goodTo - take.goodFrom) }} />
        <span className="take__fill" style={{ width: at(seconds) }} />
      </span>
    </div>
  );
};

/**
 * What is said about a take once it is recorded — only when there is
 * something worth saying.
 *
 * Short is advice, never a wall: Keep still works, because somebody whose
 * grandmother said exactly what she meant in twelve seconds should not be
 * argued with. It says the length that works and leaves "Again" where the
 * thumb is.
 */
const TakeNote = ({
  seconds,
  atMax,
  take,
}: {
  readonly seconds: number;
  readonly atMax: boolean;
  readonly take: TakeLength;
}) => {
  if (atMax) {
    return (
      <p className="note note--quiet" role="status">
        We stopped at {clock(take.max)}, the most this answer can use. Everything up to there is
        kept.
      </p>
    );
  }
  if (takeZone(seconds, take) !== "short") return null;
  return (
    <p className="note note--warn" role="status">
      {seconds < 1 ? "That was barely a second." : `That was ${clock(seconds)}.`} About{" "}
      {spokenRange(take)} gives the film the most to work with —
      if there is more to say, press Again. Otherwise keep it; it is theirs.
    </p>
  );
};

const acceptAttribute = (step: StepView): string => {
  const parts: string[] = [];
  if (step.accepts.includes("photo")) parts.push("image/*");
  if (step.accepts.includes("video")) parts.push("video/*");
  return parts.join(",");
};
