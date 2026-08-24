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

export type StepView = Omit<CaptureStepState, "asset"> & {
  readonly asset: {
    readonly id: string;
    readonly kind: "photo" | "video" | "interview";
    readonly url: string;
  } | null;
  /** Ingest's verdict in the customer's language, once ingest has run. */
  readonly qcNote?: string;
};

export type WalkthroughView = {
  readonly projectId: string;
  readonly subject: PartialSubject;
  readonly status: string;
  readonly steps: readonly StepView[];
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

const mediaUrl = async (key: string): Promise<string> =>
  usingLocalStore()
    ? `/api/media/${key}`
    : storeFromEnv().signedGetUrl(key, { expiresInSeconds: 900 });

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

  const steps: StepView[] = [];
  for (const step of walkthrough.steps) {
    const { asset, ...rest } = step;
    const note = asset === null ? undefined : qcNoteOf(asset, theirMedian);
    steps.push({
      ...rest,
      asset:
        asset === null
          ? null
          : { id: asset.id, kind: asset.kind, url: await mediaUrl(asset.storageKey) },
      ...(note === undefined ? {} : { qcNote: note }),
    });
  }
  return { ...walkthrough, steps, spokenSecondsSoFar };
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
