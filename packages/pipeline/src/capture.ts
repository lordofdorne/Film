import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { assets, projects, users, isProjectId, type Db } from "@film/db";
import { objectKey, projectPrefix, type ObjectStore } from "@film/storage";
import {
  getTemplate,
  resolveCaptureSteps,
  type ResolvedCaptureStep,
  type SubjectData,
} from "@film/templates";

import { MUSIC_BED_SLOT } from "./model.js";

/**
 * The rules of the walk-through, kept out of the web app so they can be tested.
 *
 * Everything here is a decision — may this file go in this step, is that key
 * ours, is this project finishable — and every one of them is the kind that
 * fails silently. A server action cannot be tested against a real database
 * because it drags in Next's request context; this can, and is.
 *
 * No React, no Next, no Remotion. Reachable from the web app through
 * `@film/pipeline/capture`, which is a separate entry point for the same reason
 * `/model` is: the package root pulls the render stage, and with it Remotion,
 * into whatever imports it.
 */

export type CaptureDeps = { readonly db: Db; readonly store: ObjectStore };

export type CapturedAsset = {
  readonly id: string;
  readonly kind: "photo" | "video" | "interview";
  readonly storageKey: string;
  readonly contentType: string | null;
};

export type StepState = ResolvedCaptureStep & {
  readonly asset: CapturedAsset | null;
};

export type Walkthrough = {
  readonly projectId: string;
  readonly subject: SubjectData;
  readonly status: string;
  readonly steps: readonly StepState[];
  /** Required steps still empty. Empty means the film can be started. */
  readonly missing: readonly string[];
};

export type Failure = { readonly ok: false; readonly error: string };

/** The one template on offer. A chooser is a product decision, not a gap. */
export const CAPTURE_TEMPLATE = { id: "life-advice", version: 1 } as const;

/* ── starting ─────────────────────────────────────────────────────────── */

/**
 * A project exists before capture starts.
 *
 * Assets carry a non-null project_id, so something has to exist first. It lands
 * in `capturing` — a status that has been in the enum since the schema was
 * written and has never been used by anything — and the dispatcher's ACTIVE
 * list deliberately does not include it, so nothing is planned until the
 * walk-through hands the project over.
 */
export const startCapture = async (
  deps: CaptureDeps,
  input: { readonly ownerEmail: string; readonly subject: SubjectData },
): Promise<string> => {
  const ownerId = await ensureOwner(deps.db, input.ownerEmail);
  const projectId = randomUUID();
  await deps.db.insert(projects).values({
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
 * The same shape intake uses. When Supabase Auth arrives, both become a lookup
 * against auth.users rather than an insert.
 */
const ensureOwner = async (db: Db, email: string): Promise<string> => {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const found = existing[0];
  if (found !== undefined) return found.id;

  const id = randomUUID();
  await db.insert(users).values({ id, email });
  return id;
};

/* ── reading ──────────────────────────────────────────────────────────── */

export const loadWalkthrough = async (
  deps: CaptureDeps,
  projectId: string,
): Promise<Walkthrough | null> => {
  // Not found, not a server error: the id came from the URL bar.
  if (!isProjectId(projectId)) return null;

  const rows = await deps.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const project = rows[0];
  if (project === undefined) return null;

  const subject = project.subjectData as SubjectData;
  const template = getTemplate(project.templateId, project.templateVersion);
  const captured = await deps.db.select().from(assets).where(eq(assets.projectId, projectId));

  const steps: StepState[] = resolveCaptureSteps(template, subject).map((step) => {
    const row = captured.find((a) =>
      step.kind === "question" ? a.questionId === step.questionId : a.slotId === step.slotId,
    );
    return {
      ...step,
      asset:
        row === undefined
          ? null
          : {
              id: row.id,
              kind: row.kind as "photo" | "video" | "interview",
              // The original, not the normalised file: during capture there may
              // not be a normalised file yet, and what somebody wants to check
              // is the take they just recorded.
              storageKey: row.storageKey,
              contentType: row.contentType,
            },
    };
  });

  return {
    projectId,
    subject,
    status: project.status,
    steps,
    missing: steps.filter((s) => s.required && s.asset === null).map((s) => s.id),
  };
};

/* ── uploading ────────────────────────────────────────────────────────── */

const EXTENSIONS: Readonly<Record<string, string>> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/webp": ".webp",
};

/** The bare mime type, without the codecs= parameter MediaRecorder adds. */
export const baseType = (contentType: string): string => (contentType.split(";")[0] ?? "").trim();

/** Everything stored under one original, built from the exported prefix so it
 *  cannot drift from the layout objectKey produces. */
export const originalPrefix = (projectId: string, assetId: string): string =>
  `${projectPrefix(projectId)}original/${assetId}/`;

export type PreparedUpload = {
  readonly ok: true;
  readonly assetId: string;
  readonly key: string;
  readonly contentType: string;
};

/**
 * Where the next capture may be written, if it is allowed at all.
 *
 * Deliberately returns a key rather than a URL: how bytes get to storage is the
 * caller's business — a signed PUT to R2 in production, a route in local
 * development — while what may be written where is this module's.
 */
export const prepareUpload = async (
  deps: CaptureDeps,
  input: {
    readonly projectId: string;
    readonly stepId: string;
    readonly contentType: string;
  },
): Promise<PreparedUpload | Failure> => {
  const walkthrough = await loadWalkthrough(deps, input.projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") {
    return { ok: false, error: "this film has already been started" };
  }

  const step = walkthrough.steps.find((s) => s.id === input.stepId);
  if (step === undefined) return { ok: false, error: `no step "${input.stepId}"` };

  const type = baseType(input.contentType);
  const extension = EXTENSIONS[type];
  if (extension === undefined) return { ok: false, error: `cannot accept ${type || "that file"}` };

  const isPhoto = type.startsWith("image/");
  if (!step.accepts.includes(isPhoto ? "photo" : "video")) {
    return { ok: false, error: `this step does not take ${isPhoto ? "a photo" : "video"}` };
  }

  const assetId = randomUUID();
  return {
    ok: true,
    assetId,
    key: objectKey({ projectId: input.projectId, kind: "original", assetId, name: `source${extension}` }),
    contentType: type,
  };
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
export const attachUpload = async (
  deps: CaptureDeps,
  input: {
    readonly projectId: string;
    readonly stepId: string;
    readonly assetId: string;
    readonly key: string;
    readonly contentType: string;
  },
): Promise<{ ok: true } | Failure> => {
  const walkthrough = await loadWalkthrough(deps, input.projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") {
    return { ok: false, error: "this film has already been started" };
  }
  const step = walkthrough.steps.find((s) => s.id === input.stepId);
  if (step === undefined) return { ok: false, error: `no step "${input.stepId}"` };

  // The key must be one minted for this project and this asset, not one chosen
  // by a caller who fancied writing somewhere else in the bucket.
  if (!input.key.startsWith(originalPrefix(input.projectId, input.assetId))) {
    return { ok: false, error: "that key does not belong here" };
  }

  const stored = await deps.store.head(input.key);
  if (stored === null) return { ok: false, error: "the upload did not arrive" };
  if (stored.byteSize === 0) return { ok: false, error: "the upload was empty" };

  const type = baseType(input.contentType);
  const kind =
    step.kind === "question" ? "interview" : type.startsWith("image/") ? "photo" : "video";

  await deps.db.transaction(async (tx) => {
    // A retake replaces the previous one. Deleting the row cascades its stage
    // executions, so the replacement is ingested from scratch rather than
    // inheriting measurements of a file nobody kept.
    if (step.asset !== null) await tx.delete(assets).where(eq(assets.id, step.asset.id));
    await tx.insert(assets).values({
      id: input.assetId,
      projectId: input.projectId,
      kind,
      ...(step.questionId === undefined ? {} : { questionId: step.questionId }),
      ...(step.slotId === undefined ? {} : { slotId: step.slotId }),
      storageKey: input.key,
      contentType: type,
      byteSize: stored.byteSize,
      etag: stored.etag,
      /** Finally written for real. It exists to measure which path people
       *  actually finish, and it has never had anything to say. */
      captureMethod: "browser",
    });
    await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, input.projectId));
  });

  // The replaced take's object goes after its row, never before: a row pointing
  // at a deleted object is exactly the failure this ordering avoids. The
  // extension varies with what the browser recorded, so the prefix goes.
  if (step.asset !== null) {
    await deps.store.deletePrefix(originalPrefix(input.projectId, step.asset.id));
  }

  return { ok: true };
};

/** Discard what a step captured, leaving it empty again. */
export const clearStep = async (
  deps: CaptureDeps,
  projectId: string,
  stepId: string,
): Promise<{ ok: true } | Failure> => {
  const walkthrough = await loadWalkthrough(deps, projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") {
    return { ok: false, error: "this film has already been started" };
  }
  const step = walkthrough.steps.find((s) => s.id === stepId);
  if (step === undefined || step.asset === null) return { ok: true };

  await deps.db.delete(assets).where(eq(assets.id, step.asset.id));
  await deps.store.deletePrefix(originalPrefix(projectId, step.asset.id));
  return { ok: true };
};

/* ── finishing ────────────────────────────────────────────────────────── */

/**
 * How a bed reaches a project made in a browser.
 *
 * A customer is never going to upload a music track, so the bed cannot arrive
 * the way intake's does — as a file somebody dropped in a directory. An
 * operator loads each track into the store once (scripts/upload-bed.ts) and
 * every project takes its own copy.
 *
 * Copied rather than shared: addressing in this system is project-scoped and
 * deletion is a prefix delete, so one object referenced by a hundred projects
 * would quietly break both. A few megabytes is a cheap price for keeping that
 * invariant literally true.
 */
export type BedSpec = {
  readonly trackId: string;
  readonly title: string;
  readonly cropStartMs: number;
  readonly cropEndMs: number;
  readonly crossfadeMs: number;
  readonly targetDurationMs: number;
  readonly sourceKey: string;
};

export const bedSpecKey = (trackId: string): string => `tracks/${trackId}/bed.json`;

export const loadBedSpec = async (
  store: ObjectStore,
  trackId: string,
): Promise<BedSpec | null> => {
  const key = bedSpecKey(trackId);
  if ((await store.head(key)) === null) return null;
  return JSON.parse(new TextDecoder().decode(await store.get(key))) as BedSpec;
};

/**
 * Hand the project to the pipeline.
 *
 * One transaction: the bed asset, the music config the bed is built from, and
 * the move out of `capturing`. The dispatcher does not look at capturing
 * projects, so that status change IS the handover — no new mechanism, no
 * trigger, nothing to go wrong between the two.
 */
export const finishCapture = async (
  deps: CaptureDeps,
  projectId: string,
  trackId: string,
): Promise<{ ok: true } | Failure> => {
  const walkthrough = await loadWalkthrough(deps, projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") return { ok: true };
  if (walkthrough.missing.length > 0) {
    return {
      ok: false,
      error: `${String(walkthrough.missing.length)} things are still needed`,
    };
  }

  const spec = await loadBedSpec(deps.store, trackId);
  if (spec === null) {
    return {
      ok: false,
      error:
        `No music is loaded for "${trackId}". An operator has to upload a bed ` +
        "before films can be made (pnpm bed:upload).",
    };
  }

  const source = await deps.store.get(spec.sourceKey);
  const bedAssetId = randomUUID();
  const bedKey = objectKey({ projectId, kind: "original", assetId: bedAssetId, name: "source.mp3" });
  const stored = await deps.store.put(bedKey, source, { contentType: "audio/mpeg" });

  await deps.db.transaction(async (tx) => {
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
