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
  saveDetail,
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

const qcNoteOf = (asset: NonNullable<CaptureStepState["asset"]>): string | undefined => {
  const warning = asset.warnings[0];
  if (warning !== undefined) return WORDED[warning.code] ?? warning.message;
  if (!asset.ingested) return undefined;
  if (asset.kind === "interview" && asset.speechSeconds !== null) {
    // The reassurance that it is going well, from a measurement, not a vibe.
    return asset.speechSeconds < 2
      ? "We could barely hear anything in this one — try it again?"
      : "We could hear this clearly.";
  }
  return undefined;
};

export const loadWalkthroughView = async (projectId: string): Promise<WalkthroughView | null> => {
  const walkthrough = await loadWalkthrough(deps(), projectId);
  if (walkthrough === null) return null;

  const steps: StepView[] = [];
  for (const step of walkthrough.steps) {
    const { asset, ...rest } = step;
    const note = asset === null ? undefined : qcNoteOf(asset);
    steps.push({
      ...rest,
      asset:
        asset === null
          ? null
          : { id: asset.id, kind: asset.kind, url: await mediaUrl(asset.storageKey) },
      ...(note === undefined ? {} : { qcNote: note }),
    });
  }
  return { ...walkthrough, steps };
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
    return { ok: true, mint: { assetId, key, uploadUrl: `/api/upload?${query.toString()}` } };
  }

  const uploadUrl = await storeFromEnv().signedPutUrl(key, {
    contentType: prepared.contentType,
    expiresInSeconds: 900,
  });
  return { ok: true, mint: { assetId, key, uploadUrl } };
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
