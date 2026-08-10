import "server-only";

import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { assets, createDb, isProjectId, projects, users, type Db } from "@film/db";
import { MUSIC_BED_SLOT } from "@film/pipeline/model";
import {
  objectKey,
  projectPrefix,
  storeFromEnv,
  usingLocalStore,
  type ObjectStore,
} from "@film/storage";
import {
  getTemplate,
  resolveCaptureSteps,
  type ResolvedCaptureStep,
  type SubjectData,
} from "@film/templates";

/**
 * The capture side of the server. Same rule as everywhere else in this app:
 * the browser never talks to Postgres, and it never learns a storage key it
 * was not handed for one specific upload.
 */

let cached: Db | undefined;
const db = (): Db => {
  cached ??= createDb("web").db;
  return cached;
};

const store = (): ObjectStore => storeFromEnv();

/** The one template on offer. A chooser is a product decision, not a gap. */
export const CAPTURE_TEMPLATE = { id: "life-advice", version: 1 } as const;

export type StepState = ResolvedCaptureStep & {
  /** What has been captured for this step, if anything. */
  readonly asset: {
    readonly id: string;
    readonly kind: "photo" | "video" | "interview";
    readonly url: string;
    readonly contentType: string | null;
  } | null;
};

export type Walkthrough = {
  readonly projectId: string;
  readonly subject: SubjectData;
  readonly status: string;
  readonly steps: readonly StepState[];
  /** Required steps still empty. Empty list means the film can be started. */
  readonly missing: readonly string[];
};

/* ── starting ─────────────────────────────────────────────────────────── */

export type StartInput = {
  readonly ownerEmail: string;
  readonly subject: SubjectData;
};

/**
 * A project exists before capture starts.
 *
 * Assets carry a non-null project_id, so something has to exist first. It
 * lands in `capturing` — a status that has been in the enum since the schema
 * was written and has never been used — which the dispatcher deliberately does
 * not treat as active work.
 */
export const startCapture = async (input: StartInput): Promise<string> => {
  const ownerId = await ensureOwner(input.ownerEmail);
  const projectId = randomUUID();
  await db().insert(projects).values({
    id: projectId,
    ownerId,
    templateId: CAPTURE_TEMPLATE.id,
    templateVersion: CAPTURE_TEMPLATE.version,
    subjectData: input.subject,
    config: { questionPrompts: [] },
    status: "capturing",
  });
  return projectId;
};

/**
 * The application's user row, created on demand because there is no auth yet.
 *
 * The same shape as intake's, deliberately duplicated rather than imported:
 * `@film/pipeline`'s entry pulls the render stage — and therefore Remotion —
 * into whatever imports it, and Next's page-data collection runs that outside a
 * React tree, where it fails on a missing createContext. Eight lines is a
 * cheaper price than that failure. When Supabase Auth arrives, both become a
 * lookup against auth.users and this disappears.
 */
const ensureOwner = async (email: string): Promise<string> => {
  const existing = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const found = existing[0];
  if (found !== undefined) return found.id;

  const id = randomUUID();
  await db().insert(users).values({ id, email });
  return id;
};

/* ── reading ──────────────────────────────────────────────────────────── */

const mediaUrl = async (key: string): Promise<string> =>
  usingLocalStore() ? `/api/media/${key}` : store().signedGetUrl(key, { expiresInSeconds: 900 });

export const loadWalkthrough = async (projectId: string): Promise<Walkthrough | null> => {
  if (!isProjectId(projectId)) return null;

  const rows = await db().select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const project = rows[0];
  if (project === undefined) return null;

  const subject = project.subjectData as SubjectData;
  const template = getTemplate(project.templateId, project.templateVersion);
  const captured = await db().select().from(assets).where(eq(assets.projectId, projectId));

  const steps: StepState[] = [];
  for (const step of resolveCaptureSteps(template, subject)) {
    const row = captured.find((a) =>
      step.kind === "question" ? a.questionId === step.questionId : a.slotId === step.slotId,
    );
    steps.push({
      ...step,
      asset:
        row === undefined
          ? null
          : {
              id: row.id,
              kind: row.kind as "photo" | "video" | "interview",
              // The original, not the normalised file: during capture there may
              // not be a normalised file yet, and what they want to check is
              // what they just recorded.
              url: await mediaUrl(row.storageKey),
              contentType: row.contentType,
            },
    });
  }

  return {
    projectId,
    subject,
    status: project.status,
    steps,
    missing: steps.filter((s) => s.required && s.asset === null).map((s) => s.id),
  };
};

/* ── uploading ────────────────────────────────────────────────────────── */

/**
 * Media does not proxy through the app server.
 *
 * In production that is a signed PUT straight to R2, scoped to one key and one
 * method. Locally there is no R2 and `signedPutUrl` returns a file:// URL a
 * browser cannot PUT to, so the app serves the same shape itself — the mirror
 * of /api/media, which exists so reads work with no cloud account attached.
 *
 * The local URL is signed too, rather than accepting a bare key. An endpoint
 * that writes whatever key it is handed is a hole even in development, and the
 * signature costs three lines.
 */
/**
 * Held on globalThis, not in a module constant.
 *
 * The URL is minted in a server action and verified in a route handler, and
 * those are separate module graphs — Next compiles and instantiates them
 * independently, so a module-level random would give the two sides different
 * secrets and every upload would 403. Found by uploading a photograph, not by
 * reading the code.
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
  const expected = signLocalUpload(key, expiresAt);
  // Same length either way, so a plain comparison leaks nothing useful here.
  return expected === signature;
};

const EXTENSIONS: Readonly<Record<string, string>> = {
  "video/webm": ".webm",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/webp": ".webp",
};

/** The bare mime type, without the codecs= parameter MediaRecorder adds. */
const baseType = (contentType: string): string => (contentType.split(";")[0] ?? "").trim();

export type Mint = {
  readonly assetId: string;
  readonly key: string;
  readonly uploadUrl: string;
  readonly method: "PUT";
};

export const mintUpload = async (
  projectId: string,
  stepId: string,
  contentType: string,
): Promise<{ ok: true; mint: Mint } | { ok: false; error: string }> => {
  const walkthrough = await loadWalkthrough(projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") {
    return { ok: false, error: "this film has already been started" };
  }

  const step = walkthrough.steps.find((s) => s.id === stepId);
  if (step === undefined) return { ok: false, error: `no step "${stepId}"` };

  const type = baseType(contentType);
  const extension = EXTENSIONS[type];
  if (extension === undefined) return { ok: false, error: `cannot accept ${type || "that file"}` };

  const isPhoto = type.startsWith("image/");
  if (!step.accepts.includes(isPhoto ? "photo" : "video")) {
    return { ok: false, error: `this step does not take ${isPhoto ? "a photo" : "video"}` };
  }

  const assetId = randomUUID();
  const key = objectKey({ projectId, kind: "original", assetId, name: `source${extension}` });

  if (usingLocalStore()) {
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const query = new URLSearchParams({
      key,
      exp: String(expiresAt),
      sig: signLocalUpload(key, expiresAt),
    });
    return { ok: true, mint: { assetId, key, uploadUrl: `/api/upload?${query.toString()}`, method: "PUT" } };
  }

  const uploadUrl = await store().signedPutUrl(key, { contentType: type, expiresInSeconds: 900 });
  return { ok: true, mint: { assetId, key, uploadUrl, method: "PUT" } };
};

/**
 * The row is written only once the bytes are in storage.
 *
 * This is intake's rule and it is load-bearing: the two failure orders are not
 * equally survivable. An orphaned object is invisible and can be swept; a row
 * pointing at nothing is a project that fails at ingest for a reason nobody can
 * see from the database. It is also why capture needs no "pending" column — the
 * absence of a row IS the pending state.
 */
export const completeUpload = async (
  projectId: string,
  stepId: string,
  assetId: string,
  key: string,
  contentType: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const walkthrough = await loadWalkthrough(projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") {
    return { ok: false, error: "this film has already been started" };
  }
  const step = walkthrough.steps.find((s) => s.id === stepId);
  if (step === undefined) return { ok: false, error: `no step "${stepId}"` };

  // The key must be the one we minted for this project, not one supplied by a
  // caller who fancied writing somewhere else.
  if (!key.startsWith(originalPrefix(projectId, assetId))) {
    return { ok: false, error: "that key does not belong here" };
  }

  const stored = await store().head(key);
  if (stored === null) return { ok: false, error: "the upload did not arrive" };
  if (stored.byteSize === 0) return { ok: false, error: "the upload was empty" };

  const type = baseType(contentType);
  const kind = step.kind === "question" ? "interview" : type.startsWith("image/") ? "photo" : "video";

  await db().transaction(async (tx) => {
    // A retake replaces the previous take. Deleting the row cascades its stage
    // executions, so a re-ingest is planned from scratch rather than reusing
    // measurements of a file nobody kept.
    if (step.asset !== null) await tx.delete(assets).where(eq(assets.id, step.asset.id));
    await tx.insert(assets).values({
      id: assetId,
      projectId,
      kind,
      ...(step.questionId === undefined ? {} : { questionId: step.questionId }),
      ...(step.slotId === undefined ? {} : { slotId: step.slotId }),
      storageKey: key,
      contentType: type,
      byteSize: stored.byteSize,
      etag: stored.etag,
      captureMethod: "browser",
    });
    await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  });

  // The replaced take's object goes after its row is gone, never before: a row
  // pointing at a deleted object is exactly the failure this ordering avoids.
  // The extension varies by what the browser recorded, so the prefix goes.
  if (step.asset !== null) {
    await store().deletePrefix(originalPrefix(projectId, step.asset.id));
  }

  return { ok: true };
};

/** Everything stored under one original. Built from the exported prefix so
 *  this cannot drift from the key layout objectKey produces. */
const originalPrefix = (projectId: string, assetId: string): string =>
  `${projectPrefix(projectId)}original/${assetId}/`;

/* ── finishing ────────────────────────────────────────────────────────── */

/**
 * The bed a finished project is scored with.
 *
 * A customer is never going to upload a music track, so the bed cannot arrive
 * the way intake's does — as a file somebody dropped in a directory. An
 * operator puts each track in the store once (scripts/upload-bed.ts) and every
 * project takes its own copy.
 *
 * Copied rather than shared: content addressing in this system is
 * project-scoped, deletion is a prefix delete, and a track object referenced by
 * a hundred projects would quietly break both. A few megabytes is a cheap
 * price for keeping that invariant literally true.
 */
const BED_TRACK_ID = process.env["CAPTURE_BED_TRACK_ID"] ?? "temp-end-of-august";

type BedSpec = {
  readonly trackId: string;
  readonly title: string;
  readonly cropStartMs: number;
  readonly cropEndMs: number;
  readonly crossfadeMs: number;
  readonly targetDurationMs: number;
  readonly sourceKey: string;
};

const loadBedSpec = async (): Promise<BedSpec | null> => {
  const specKey = `tracks/${BED_TRACK_ID}/bed.json`;
  const head = await store().head(specKey);
  if (head === null) return null;
  const raw = await store().get(specKey);
  return JSON.parse(new TextDecoder().decode(raw)) as BedSpec;
};

/**
 * Hand the project to the pipeline.
 *
 * One transaction: the bed asset, the music config the bed is built from, and
 * the move out of `capturing`. The dispatcher does not look at capturing
 * projects at all, so this status change IS the handover — there is no new
 * mechanism, no trigger, and nothing to go wrong between the two.
 */
export const finishCapture = async (
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const walkthrough = await loadWalkthrough(projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") return { ok: true };
  if (walkthrough.missing.length > 0) {
    return { ok: false, error: `${String(walkthrough.missing.length)} steps are still empty` };
  }

  const spec = await loadBedSpec();
  if (spec === null) {
    return {
      ok: false,
      error:
        `No music is loaded for "${BED_TRACK_ID}". An operator has to upload a bed ` +
        "before films can be made (pnpm bed:upload).",
    };
  }

  const source = await store().get(spec.sourceKey);
  const bedAssetId = randomUUID();
  const bedKey = objectKey({
    projectId,
    kind: "original",
    assetId: bedAssetId,
    name: "source.mp3",
  });
  const stored = await store().put(bedKey, source, { contentType: "audio/mpeg" });

  await db().transaction(async (tx) => {
    await tx.insert(assets).values({
      id: bedAssetId,
      projectId,
      kind: "audio",
      slotId: MUSIC_BED_SLOT,
      storageKey: bedKey,
      contentType: "audio/mpeg",
      byteSize: stored.byteSize,
      etag: stored.etag,
      captureMethod: "browser",
    });
    await tx
      .update(projects)
      .set({
        config: {
          questionPrompts: [],
          music: {
            trackId: spec.trackId,
            title: spec.title,
            cropStartMs: spec.cropStartMs,
            cropEndMs: spec.cropEndMs,
            crossfadeMs: spec.crossfadeMs,
            targetDurationMs: spec.targetDurationMs,
          },
        },
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
  });

  return { ok: true };
};

/** Discard what a step captured, leaving it empty again. */
export const clearStep = async (
  projectId: string,
  stepId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const walkthrough = await loadWalkthrough(projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") {
    return { ok: false, error: "this film has already been started" };
  }
  const step = walkthrough.steps.find((s) => s.id === stepId);
  if (step === undefined || step.asset === null) return { ok: true };

  await db().delete(assets).where(eq(assets.id, step.asset.id));
  await store().deletePrefix(originalPrefix(projectId, step.asset.id));
  return { ok: true };
};
