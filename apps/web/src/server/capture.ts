import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { createDb, type Db } from "@film/db";
import {
  attachUpload,
  clearStep,
  ensureAnonymousOwner,
  finishCapture,
  loadWalkthrough,
  prepareUpload,
  medianSeconds,
  saveDetail,
  spokenVerdict,
  startCapture,
  type CaptureDeps,
  type StepState as CaptureStepState,
  type Failure,
  type SavedDetail,
} from "@film/pipeline/capture";
import { storeFromEnv, usingLocalStore } from "@film/storage";
import type { PartialSubject } from "@film/templates";

/**
 * The web app's side of capture: URLs, and nothing else.
 *
 * Every decision — may this file go in this step, is that key ours, can this
 * project be finished — lives in `@film/pipeline/capture`, where it is tested
 * against a real Postgres and a real object store. What is left here is the
 * part that is genuinely about being a web app: turning a storage key into
 * something a browser can fetch, and minting an upload URL.
 */

let cached: Db | undefined;
const deps = (): CaptureDeps => {
  cached ??= createDb("web").db;
  return { db: cached, store: storeFromEnv() };
};

/** Which bed a project made in the browser is scored with. */
const BED_TRACK_ID = process.env["CAPTURE_BED_TRACK_ID"] ?? "temp-end-of-august";

/**
 * Reading the rows and minting the URLs are two separate acts, and the types
 * are what keep them separate.
 *
 * A signed URL is a bearer credential. Loading a walk-through used to mint one
 * for every asset on it — so a step sheet, which shows exactly one, put
 * eighteen credentials for whole interview takes into its HTML, seventeen of
 * which nothing on the page ever fetched. It was not a leak, but it was a
 * standing offer of one, renewed on every render.
 *
 * So `loadWalkthroughView` now signs NOTHING. It returns storage keys, which
 * never leave the server, and a caller that wants URLs asks for exactly the
 * ones it will draw. The rule is a type rather than a habit: a component
 * cannot be handed the unsigned shape by accident, because it does not have a
 * `url` on it to render.
 */
type CapturedRef = {
  readonly id: string;
  readonly kind: "photo" | "video" | "interview";
  /** Server-side only. A storage key must never reach a browser. */
  readonly storageKey: string;
  readonly thumbnailKey: string | null;
};

type Step<Asset> = Omit<CaptureStepState, "asset"> & {
  readonly asset: Asset | null;
  /** Ingest's verdict in the customer's language, once ingest has run. */
  readonly qcNote?: string;
};

/** What a card in a list needs: a small picture, or none yet. */
export type HubStep = Step<{
  readonly id: string;
  readonly kind: "photo" | "video" | "interview";
  /**
   * A small picture of it. Absent until something has made one.
   *
   * Absent rather than falling back to the original, and that is the point of
   * the field. A card that falls back draws a 7 MB photograph at 56 pixels
   * wide — exactly what this exists to stop. A card with no thumbnail yet
   * draws a placeholder for the few seconds until ingest has been.
   */
  readonly thumbUrl?: string;
}>;

/** What one step sheet needs: the real thing, and a poster to hold until it
 *  is asked for. */
export type StepView = Step<{
  readonly id: string;
  readonly kind: "photo" | "video" | "interview";
  readonly url: string;
  readonly thumbUrl?: string;
}>;

type Walkthrough<S> = {
  readonly projectId: string;
  readonly subject: PartialSubject;
  readonly status: string;
  readonly steps: readonly S[];
  readonly missing: readonly string[];
  /**
   * Seconds of speech recorded so far, across every answer ingest has seen.
   *
   * Deliberately "of answers", not a predicted film length: guessing the
   * finished duration means modelling the edit, and a number that turns out
   * wrong on the preview screen is worse than no number at all.
   */
  readonly spokenSecondsSoFar: number;
};

/** Rows, keys, and no credentials. What every page loads first. */
export type WalkthroughView = Walkthrough<Step<CapturedRef>>;
/** The same walk-through with a thumbnail URL on every card. */
export type HubView = Walkthrough<HubStep>;

const mediaUrl = async (key: string): Promise<string> =>
  usingLocalStore()
    ? `/api/media/${key}`
    : storeFromEnv().signedGetUrl(key, { expiresInSeconds: 900 });

/**
 * How long the same thumbnail keeps the same URL.
 *
 * Five minutes. A signature normally carries the instant it was made, so the
 * hub handed the browser seventeen brand-new URLs on every render — and it
 * re-renders on every window focus, because `FreshenOnReturn` keeps the signed
 * URLs from expiring under a page left open. Nothing was ever a cache hit, so
 * refreshing the page to keep its URLs alive downloaded every picture on it.
 *
 * Rounding the signing clock to the current five-minute mark makes those
 * renders produce identical URLs, so the second one is free. The credential is
 * unchanged in every other way: still fifteen minutes at most, still scoped to
 * one key and one method, still a private bucket. The rejected alternatives —
 * a public bucket, or a URL signed for a day — would also have got a cache,
 * for recordings of somebody's grandmother.
 *
 * Only thumbnails. A take's URL is minted when somebody opens that one step,
 * where there is nothing to repeat and no reason to spend any of its life.
 */
const THUMBNAIL_URL_STABLE_SECONDS = 300;

const thumbnailUrl = async (key: string): Promise<string> =>
  usingLocalStore()
    ? `/api/media/${key}`
    : storeFromEnv().signedGetUrl(key, {
        expiresInSeconds: 900,
        stableForSeconds: THUMBNAIL_URL_STABLE_SECONDS,
      });

/**
 * Ingest's verdict, in the customer's language rather than the QC code's.
 *
 * These strings are generic to any film type — they talk about light, sound
 * and sharpness, never about a template's content — which is what keeps them
 * allowed in the web app at all.
 */
const WORDED: Readonly<Record<string, string>> = {
  LOW_RESOLUTION: "This looks a little soft on a big screen — a phone recording would be sharper.",
};

const qcNoteOf = (
  asset: NonNullable<CaptureStepState["asset"]>,
  theirMedianSeconds: number,
): string | undefined => {
  if (!asset.ingested) return undefined;

  /**
   * Length outranks the picture, and only for the takes where it matters.
   *
   * There is room for one sentence on a card, so the order decides what
   * somebody hears. A four-second answer told "this looks a little soft on a
   * big screen" has been given the less useful of two true things: soft still
   * makes a film, and four seconds is what leaves them with a two-minute one.
   * Found by watching a real card show the wrong note.
   *
   * Only for the short and the inaudible. A take that is fine on length falls
   * through to the picture warnings, which is where they belong.
   */
  const verdict =
    asset.kind === "interview" && asset.speechSeconds !== null
      ? spokenVerdict(asset.speechSeconds, theirMedianSeconds)
      : "clear";

  if (verdict === "inaudible") return "We could barely hear anything in this one — try it again?";
  if (verdict === "short") {
    return (
      `That was about ${String(Math.round(asset.speechSeconds ?? 0))} seconds. ` +
      "If there is more to say, another go gives the film more to work with."
    );
  }

  const warning = asset.warnings[0];
  if (warning !== undefined) return WORDED[warning.code] ?? warning.message;
  if (asset.kind !== "interview" || asset.speechSeconds === null) return undefined;

  // Fine on length and nothing wrong with the picture: say so. The
  // reassurance that it is going well, from a measurement rather than a vibe.
  return "We could hear this clearly.";
};

export const loadWalkthroughView = async (projectId: string): Promise<WalkthroughView | null> => {
  const walkthrough = await loadWalkthrough(deps(), projectId);
  if (walkthrough === null) return null;

  /**
   * How much has been said so far, and the middle of it.
   *
   * Both are measured from what ingest already recorded, across the whole
   * film rather than one card, because one short answer is nothing and five
   * is a two-minute film. The hub shows the total; each card is judged
   * against the median.
   */
  const spoken = walkthrough.steps
    .map((s) => s.asset)
    .filter((a) => a !== null && a.kind === "interview" && a.speechSeconds !== null)
    .map((a) => a?.speechSeconds ?? 0);

  const spokenSecondsSoFar = Math.round(spoken.reduce((total, s) => total + s, 0));
  const theirMedian = medianSeconds(spoken);

  const steps: Step<CapturedRef>[] = walkthrough.steps.map((step) => {
    const { asset, ...rest } = step;
    const note = asset === null ? undefined : qcNoteOf(asset, theirMedian);
    return {
      ...rest,
      asset:
        asset === null
          ? null
          : {
              id: asset.id,
              kind: asset.kind,
              storageKey: asset.storageKey,
              thumbnailKey: asset.thumbnailKey,
            },
      ...(note === undefined ? {} : { qcNote: note }),
    };
  });
  return { ...walkthrough, steps, spokenSecondsSoFar };
};

/**
 * Every card's thumbnail, and nothing else.
 *
 * Seventeen small signed URLs where there used to be seventeen small ones AND
 * seventeen for the originals — whole interview takes, none of which the hub
 * has drawn since it started using thumbnails. They were minted, embedded and
 * ignored.
 */
export const withThumbnails = async (view: WalkthroughView): Promise<HubView> => {
  const steps: HubStep[] = [];
  for (const step of view.steps) {
    const { asset, ...rest } = step;
    steps.push({
      ...rest,
      asset:
        asset === null
          ? null
          : {
              id: asset.id,
              kind: asset.kind,
              ...(asset.thumbnailKey === null
                ? {}
                : { thumbUrl: await thumbnailUrl(asset.thumbnailKey) }),
            },
    });
  }
  return { ...view, steps };
};

/**
 * One step, with the URLs that one step will actually use.
 *
 * The rows for the whole walk-through are still read to get here, and that is
 * deliberate rather than overlooked: it is a single query measured at 11 ms
 * warm, the template work on top of it is microseconds, and the step sheet
 * needs the project's status and this step's QC note — which is judged against
 * the median of every OTHER answer, so it cannot be computed from one row.
 * What was worth removing was never the read. It was the seventeen credentials
 * minted alongside it.
 */
export const stepWithMedia = async (
  view: WalkthroughView,
  stepId: string,
): Promise<StepView | null> => {
  const step = view.steps.find((s) => s.id === stepId);
  if (step === undefined) return null;

  const { asset, ...rest } = step;
  if (asset === null) return { ...rest, asset: null };

  return {
    ...rest,
    asset: {
      id: asset.id,
      kind: asset.kind,
      url: await mediaUrl(asset.storageKey),
      ...(asset.thumbnailKey === null
        ? {}
        : { thumbUrl: await thumbnailUrl(asset.thumbnailKey) }),
    },
  };
};

/**
 * The chooser's door: a project of the chosen kind, owned by the session —
 * or, on a server with no auth at all, by a fresh anonymous row.
 */
export const createProjectFor = async (
  ownerId: string | null,
  templateId: string,
  templateVersion: number,
): Promise<{ ok: true; projectId: string } | Failure> => {
  const d = deps();
  const owner = ownerId ?? (await ensureAnonymousOwner(d.db));
  return startCapture(d, { ownerId: owner, templateId, templateVersion });
};

export const saveDetailFor = async (
  projectId: string,
  fieldId: string,
  value: string,
): Promise<SavedDetail | Failure> => saveDetail(deps(), { projectId, fieldId, value });

/* ── upload URLs ──────────────────────────────────────────────────────── */

/**
 * Held on globalThis, not in a module constant.
 *
 * The URL is minted in a server action and verified in a route handler, and
 * Next compiles those as separate module graphs — so a module-level random gave
 * the two sides different secrets and every upload answered 403. Found by
 * uploading a photograph, not by reading the code.
 */
const uploadSecret = (): string => {
  const holder = globalThis as { __captureUploadSecret?: string };
  holder.__captureUploadSecret ??=
    process.env["CAPTURE_UPLOAD_SECRET"] ?? randomBytes(32).toString("hex");
  return holder.__captureUploadSecret;
};

export const signLocalUpload = (key: string, expiresAt: number): string =>
  createHmac("sha256", uploadSecret()).update(`${key}\n${String(expiresAt)}`).digest("hex");

export const verifyLocalUpload = (key: string, expiresAt: number, signature: string): boolean => {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return signLocalUpload(key, expiresAt) === signature;
};

export type Mint = {
  readonly assetId: string;
  readonly key: string;
  readonly uploadUrl: string;
  /**
   * The content type the URL was signed for, which the browser must send back
   * verbatim.
   *
   * R2 covers ContentType in the signature, and MediaRecorder's own type
   * carries a codecs parameter — `video/webm;codecs=vp9,opus` — while
   * prepareUpload deliberately stores the base type. Sending one and signing
   * the other is a 403 from R2 that local development can never reproduce,
   * because the local upload route does not check. So the mint says what was
   * signed and the client repeats it: one authority, not two that agree by
   * coincidence.
   */
  readonly contentType: string;
};

/**
 * Media never proxies through the app server in production.
 *
 * A signed PUT goes straight to R2, scoped to one key and one method. Locally
 * there is no R2 and the local store's signedPutUrl returns a file:// URL a
 * browser cannot PUT to, so the app serves the same shape itself — the mirror
 * of /api/media, which exists so the offline path stays first-class.
 */
export const mintUpload = async (
  projectId: string,
  stepId: string,
  contentType: string,
): Promise<{ ok: true; mint: Mint } | Failure> => {
  const prepared = await prepareUpload(deps(), { projectId, stepId, contentType });
  if (!prepared.ok) return prepared;

  const { assetId, key } = prepared;

  if (usingLocalStore()) {
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const query = new URLSearchParams({
      key,
      exp: String(expiresAt),
      sig: signLocalUpload(key, expiresAt),
    });
    return {
      ok: true,
      mint: {
        assetId,
        key,
        uploadUrl: `/api/upload?${query.toString()}`,
        contentType: prepared.contentType,
      },
    };
  }

  const uploadUrl = await storeFromEnv().signedPutUrl(key, {
    contentType: prepared.contentType,
    expiresInSeconds: 900,
  });
  return { ok: true, mint: { assetId, key, uploadUrl, contentType: prepared.contentType } };
};

export const completeUpload = async (
  projectId: string,
  stepId: string,
  assetId: string,
  key: string,
  contentType: string,
): Promise<{ ok: true } | Failure> =>
  attachUpload(deps(), { projectId, stepId, assetId, key, contentType });

export const discardCapture = async (
  projectId: string,
  stepId: string,
): Promise<{ ok: true } | Failure> => clearStep(deps(), projectId, stepId);

export const startTheFilmFor = async (projectId: string): Promise<{ ok: true } | Failure> =>
  finishCapture(deps(), projectId, BED_TRACK_ID);
