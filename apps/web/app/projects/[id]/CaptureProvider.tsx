"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { finishUpload, mintUploadFor } from "../../../src/server/captureActions.js";

/**
 * The camera and the uploads, for the whole film — not for one screen.
 *
 * Both used to belong to the step on screen, and both died with it. Every
 * question started the camera from cold (half a second to two, with nothing
 * on screen, and recording began the moment it woke, before anybody could see
 * themselves); and Keep waited for the take to upload, then for the server,
 * then for a full refresh, before it would move on. On a phone that is
 * minutes per question. Phase 8, Block 2 moves both here, into a layout that
 * stays mounted while the screens inside it change.
 *
 * The camera: one stream, shared by every recording step. A step asks for it
 * when it opens; leaving the recording steps lets it go a moment later (so
 * the next question finds it still on), and so does hiding the tab — a camera
 * left on in somebody's pocket is a privacy bug and a battery one.
 *
 * The uploads: a queue. A take is handed over and the person moves on; it
 * goes up behind them, one at a time so a phone's thin uplink is not split
 * three ways, retried when the connection drops, and the browser's own
 * "leave site?" warning stands guard while anything is still on its way.
 *
 * The two are separate contexts, and the uploads' state is a store that each
 * screen reads only the part of. A take going up reports progress dozens of
 * times a second, and when that progress was one context value every screen
 * under the film re-rendered on every report — the camera preview, the
 * recording clock, the whole step — for a take that belonged to the question
 * before. Now a step re-renders for its own take, the status line for the
 * summary, and nothing else hears about it.
 */

/* ── camera ─────────────────────────────────────────────────────────── */

export type CameraMode = "video" | "photo";

/** What a recording asks of the camera: the person, framed, with sound. */
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  audio: true,
};

/**
 * What a photograph asks: the back camera on a phone, as many pixels as it
 * has, and no microphone — asking for one to take a still is a permission
 * prompt that frightens people for nothing.
 */
const PHOTO_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 2560 }, height: { ideal: 1920 }, facingMode: { ideal: "environment" } },
  audio: false,
};

/** Long enough to reach the next question with the camera still on. */
const RELEASE_AFTER_MS = 1_500;

/** Remembered for the tab, so the next screen can start the camera unasked. */
const ALLOWED_KEY = "porch.camera-allowed";

type Camera = {
  readonly stream: MediaStream | null;
  readonly mode: CameraMode | null;
  /** Permission was given in this tab: a step may start the camera unasked. */
  readonly allowed: boolean;
  /** The camera for `mode`, reusing the one already on when it can. */
  readonly acquire: (mode: CameraMode) => Promise<MediaStream>;
  /** This screen is done with it; another may pick it up in a moment. */
  readonly letGo: () => void;
  /** Off now, whatever anyone wanted. */
  readonly stop: () => void;
};

/* ── uploads ────────────────────────────────────────────────────────── */

export type UploadState = {
  readonly stepId: string;
  readonly state: "queued" | "saving" | "saved" | "failed";
  /** 0–1 while bytes are going up, when the browser can tell. */
  readonly progress?: number;
  readonly error?: string;
  /** This browser's own copy, to show until the server has it. */
  readonly localUrl: string;
  readonly isPhoto: boolean;
};

/** The queue's numbers, for the status line and Make my film. */
export type UploadSummary = {
  /** Not yet saved: queued, going up, or failed. */
  readonly pending: number;
  readonly failed: number;
  /** The steps whose take failed every retry, for one "Try again" over all. */
  readonly failedSteps: readonly string[];
  /** Progress of the one going up now, 0–1. */
  readonly current?: number;
  /** Queued or going up: closing the tab now would lose it. */
  readonly unsaved: boolean;
};

/** What a screen can do with the queue. Never changes identity. */
type Uploads = {
  readonly enqueue: (stepId: string, blob: Blob, contentType: string, isPhoto: boolean) => void;
  readonly retry: (stepId: string) => void;
  /** Forget a take that has not finished going up (Remove, or replaced). */
  readonly cancel: (stepId: string) => void;
};

type UploadStore = {
  readonly byStep: () => Readonly<Record<string, UploadState>>;
  readonly summary: () => UploadSummary;
  readonly subscribe: (listener: () => void) => () => void;
};

type Capture = { readonly camera: Camera; readonly uploads: Uploads };

const CameraContext = createContext<Camera | null>(null);
const UploadsContext = createContext<(Uploads & { readonly store: UploadStore }) | null>(null);

const useUploadsContext = () => {
  const uploads = useContext(UploadsContext);
  if (uploads === null) throw new Error("used outside CaptureProvider");
  return uploads;
};

export const useCamera = (): Camera => {
  const camera = useContext(CameraContext);
  if (camera === null) throw new Error("useCamera outside CaptureProvider");
  return camera;
};

/** The queue's actions. Reading them re-renders nothing. */
export const useUploads = (): Uploads => useUploadsContext();

/** One step's take on its way up, or undefined. Re-renders only for that step. */
export const useUpload = (stepId: string): UploadState | undefined => {
  const { store } = useUploadsContext();
  const read = useCallback(() => store.byStep()[stepId], [store, stepId]);
  return useSyncExternalStore(store.subscribe, read, noUpload);
};

/** The queue's numbers. Re-renders only when one of them changes. */
export const useUploadSummary = (): UploadSummary => {
  const { store } = useUploadsContext();
  return useSyncExternalStore(store.subscribe, store.summary, emptySummary);
};

export const useCapture = (): Capture => ({ camera: useCamera(), uploads: useUploads() });

const noUpload = (): undefined => undefined;
const EMPTY_SUMMARY: UploadSummary = { pending: 0, failed: 0, failedSteps: [], unsaved: false };
const emptySummary = (): UploadSummary => EMPTY_SUMMARY;

const summarise = (byStep: Readonly<Record<string, UploadState>>): UploadSummary => {
  const values = Object.values(byStep);
  const failedSteps = values.filter((u) => u.state === "failed").map((u) => u.stepId);
  const current = values.find((u) => u.state === "saving")?.progress;
  return {
    pending: values.filter((u) => u.state !== "saved").length,
    failed: failedSteps.length,
    failedSteps,
    ...(current === undefined ? {} : { current }),
    unsaved: values.some((u) => u.state === "queued" || u.state === "saving"),
  };
};

/** Same numbers, same object: what lets a subscriber skip the render. */
const sameSummary = (a: UploadSummary, b: UploadSummary): boolean =>
  a.pending === b.pending &&
  a.failed === b.failed &&
  a.current === b.current &&
  a.unsaved === b.unsaved &&
  a.failedSteps.join("\n") === b.failedSteps.join("\n");

/** Backoff between automatic retries; after the last, it waits for Retry. */
const RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

/**
 * PUT with upload progress, cancellable.
 *
 * `fetch` cannot report upload progress, and a take is tens of megabytes on
 * a phone connection: "Saving…" with no number for a minute reads as stuck.
 */
const put = (
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
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
    signal.addEventListener("abort", () => { xhr.abort(); });
    xhr.send(body);
  });

type Job = {
  readonly stepId: string;
  readonly blob: Blob;
  readonly contentType: string;
  attempts: number;
  controller: AbortController;
};

export const CaptureProvider = ({
  projectId,
  children,
}: {
  readonly projectId: string;
  readonly children: React.ReactNode;
}) => {
  /* camera */
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<CameraMode | null>(null);
  const [allowed, setAllowed] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<CameraMode | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingAcquire = useRef<{ mode: CameraMode; promise: Promise<MediaStream> } | null>(null);

  useEffect(() => {
    try {
      setAllowed(sessionStorage.getItem(ALLOWED_KEY) === "1");
    } catch {
      // Private mode, or storage blocked: the camera just asks first.
    }
  }, []);

  const stop = useCallback(() => {
    clearTimeout(releaseTimer.current);
    streamRef.current?.getTracks().forEach((t) => { t.stop(); });
    streamRef.current = null;
    modeRef.current = null;
    pendingAcquire.current = null;
    setStream(null);
    setMode(null);
  }, []);

  const acquire = useCallback(
    async (wanted: CameraMode): Promise<MediaStream> => {
      clearTimeout(releaseTimer.current);
      const live = streamRef.current;
      if (live !== null && modeRef.current === wanted && live.getTracks().every((t) => t.readyState === "live")) {
        return live;
      }
      // Two screens asking at once (a fast Back) share one request.
      if (pendingAcquire.current?.mode === wanted) return pendingAcquire.current.promise;

      // One camera at a time: a phone will not open the back camera while the
      // front one is still held.
      if (live !== null) stop();
      const promise = navigator.mediaDevices
        .getUserMedia(wanted === "video" ? VIDEO_CONSTRAINTS : PHOTO_CONSTRAINTS)
        .then((next) => {
          streamRef.current = next;
          modeRef.current = wanted;
          pendingAcquire.current = null;
          setStream(next);
          setMode(wanted);
          setAllowed(true);
          try {
            sessionStorage.setItem(ALLOWED_KEY, "1");
          } catch {
            // As above.
          }
          return next;
        })
        .catch((error: unknown) => {
          pendingAcquire.current = null;
          throw error;
        });
      pendingAcquire.current = { mode: wanted, promise };
      return promise;
    },
    [stop],
  );

  const letGo = useCallback(() => {
    clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(stop, RELEASE_AFTER_MS);
  }, [stop]);

  // Off when the tab is hidden, and when the film's pages are left altogether.
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      stop();
    };
  }, [stop]);

  /* uploads */
  const byStepRef = useRef<Readonly<Record<string, UploadState>>>({});
  const summaryRef = useRef<UploadSummary>(EMPTY_SUMMARY);
  const listeners = useRef(new Set<() => void>());

  const setByStep = useCallback(
    (change: (all: Readonly<Record<string, UploadState>>) => Readonly<Record<string, UploadState>>) => {
      const before = byStepRef.current;
      const after = change(before);
      if (after === before) return;
      byStepRef.current = after;
      const summary = summarise(after);
      if (!sameSummary(summary, summaryRef.current)) summaryRef.current = summary;
      for (const listener of listeners.current) listener();
    },
    [],
  );

  const store = useMemo<UploadStore>(
    () => ({
      byStep: () => byStepRef.current,
      summary: () => summaryRef.current,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => { listeners.current.delete(listener); };
      },
    }),
    [],
  );

  const queue = useRef<Job[]>([]);
  const running = useRef(false);
  /** Each take's bytes, kept until saved so Retry has something to send. */
  const blobs = useRef<Record<string, { blob: Blob; contentType: string }>>({});

  const patch = useCallback((stepId: string, change: Partial<UploadState>) => {
    setByStep((all) => {
      const before = all[stepId];
      return before === undefined ? all : { ...all, [stepId]: { ...before, ...change } };
    });
  }, [setByStep]);

  const pump = useCallback(async (): Promise<void> => {
    if (running.current) return;
    const job = queue.current[0];
    if (job === undefined) return;
    running.current = true;
    patch(job.stepId, { state: "saving", progress: 0 });

    const fail = (error: string) => {
      job.attempts += 1;
      const delay = RETRY_DELAYS_MS[job.attempts - 1];
      if (delay === undefined || job.controller.signal.aborted) {
        queue.current = queue.current.filter((j) => j !== job);
        if (!job.controller.signal.aborted) patch(job.stepId, { state: "failed", error });
      } else {
        // Back of the queue, after a wait: one bad connection should not hold
        // up the takes behind it.
        queue.current = [...queue.current.filter((j) => j !== job), job];
        patch(job.stepId, { state: "queued" });
      }
      running.current = false;
      if (delay !== undefined) setTimeout(() => { void pump(); }, delay);
      else void pump();
    };

    try {
      const minted = await mintUploadFor(projectId, job.stepId, job.contentType);
      if (!minted.ok) return fail(minted.error);
      const { assetId, key, uploadUrl, contentType: signedType } = minted.mint;

      /**
       * Straight to storage, with the type the URL was SIGNED for — not the
       * blob's own. R2 covers content-type in the signature, and
       * MediaRecorder says `video/webm;codecs=vp9,opus`; sending that would be
       * a 403 on every recording, and one local development cannot reproduce.
       */
      // Whole percents only: the browser reports far more often than a
      // number on screen can change, and each report is a render.
      let shown = 0;
      const landed = await put(
        uploadUrl,
        job.blob,
        signedType,
        (fraction) => {
          const percent = Math.floor(fraction * 100);
          if (percent === shown) return;
          shown = percent;
          patch(job.stepId, { progress: percent / 100 });
        },
        job.controller.signal,
      );
      if (job.controller.signal.aborted) return fail("cancelled");
      if (!landed) return fail("That did not reach us.");

      // The row is written only once the bytes are known to have landed. Its
      // revalidation re-renders whichever screen is up, so the progress bar
      // and the overview tick without anybody asking for a refresh.
      const done = await finishUpload(projectId, job.stepId, assetId, key, signedType);
      if (!done.ok) return fail(done.error);

      queue.current = queue.current.filter((j) => j !== job);
      delete blobs.current[job.stepId];
      patch(job.stepId, { state: "saved", progress: 1 });
      running.current = false;
      void pump();
    } catch {
      fail("That did not reach us.");
    }
  }, [patch, projectId]);

  const cancel = useCallback((stepId: string) => {
    for (const job of queue.current) if (job.stepId === stepId) job.controller.abort();
    queue.current = queue.current.filter((j) => j.stepId !== stepId);
    delete blobs.current[stepId];
    setByStep((all) => {
      const { [stepId]: gone, ...rest } = all;
      if (gone !== undefined) URL.revokeObjectURL(gone.localUrl);
      return rest;
    });
  }, [setByStep]);

  const enqueue = useCallback(
    (stepId: string, blob: Blob, contentType: string, isPhoto: boolean) => {
      // A new take for a step replaces whatever was on its way for it.
      for (const job of queue.current) if (job.stepId === stepId) job.controller.abort();
      queue.current = queue.current.filter((j) => j.stepId !== stepId);
      setByStep((all) => {
        const old = all[stepId];
        if (old !== undefined) URL.revokeObjectURL(old.localUrl);
        return {
          ...all,
          [stepId]: { stepId, state: "queued", localUrl: URL.createObjectURL(blob), isPhoto },
        };
      });
      queue.current.push({ stepId, blob, contentType, attempts: 0, controller: new AbortController() });
      void pump();
    },
    [pump, setByStep],
  );

  const enqueueKeeping = useCallback(
    (stepId: string, blob: Blob, contentType: string, isPhoto: boolean) => {
      blobs.current[stepId] = { blob, contentType };
      enqueue(stepId, blob, contentType, isPhoto);
    },
    [enqueue],
  );

  // Read from the store rather than closed over, so Retry keeps one identity.
  const retry = useCallback(
    (stepId: string) => {
      const kept = blobs.current[stepId];
      const was = byStepRef.current[stepId];
      if (kept === undefined || was === undefined) return;
      enqueue(stepId, kept.blob, kept.contentType, was.isPhoto);
    },
    [enqueue],
  );

  /**
   * Closing the tab with a take still on its way loses it, and nothing on the
   * page can say so in time. The browser's own "leave site?" is the one
   * warning that arrives before it is too late.
   */
  const unsaved = useSyncExternalStore(store.subscribe, () => store.summary().unsaved, () => false);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); };
  }, [unsaved]);

  const camera = useMemo<Camera>(
    () => ({ stream, mode, allowed, acquire, letGo, stop }),
    [stream, mode, allowed, acquire, letGo, stop],
  );
  const uploads = useMemo(
    () => ({ enqueue: enqueueKeeping, retry, cancel, store }),
    [enqueueKeeping, retry, cancel, store],
  );

  return (
    <CameraContext.Provider value={camera}>
      <UploadsContext.Provider value={uploads}>{children}</UploadsContext.Provider>
    </CameraContext.Provider>
  );
};
