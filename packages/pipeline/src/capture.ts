import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { assets, projects, users, isProjectId, type Db } from "@film/db";
import { objectKey, projectPrefix, type ObjectStore } from "@film/storage";
import {
  getTemplate,
  resolveCaptureSteps,
  type DetailField,
  type PartialSubject,
  type ResolvedCaptureStep,
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
  /**
   * A small picture of this asset, once something has made one. Null before
   * that.
   *
   * Null rather than "fall back to the original": a list that falls back
   * downloads the whole film to draw its cards, which is measurably what the
   * hub used to do.
   */
  readonly thumbnailKey: string | null;
  readonly contentType: string | null;
  /** Whether ingest has looked at this yet. False right after an upload. */
  readonly ingested: boolean;
  /** Ingest's verdicts, verbatim. The web app words them for the customer. */
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  /** Seconds of actual speech ingest heard in an interview take, once known.
   *  The reassurance the plan asked for — "we could hear you" — comes from
   *  this, and so does its opposite. */
  readonly speechSeconds: number | null;
};

export type StepState = ResolvedCaptureStep & {
  readonly asset: CapturedAsset | null;
  /** A detail step's answer, if given. Media steps never carry one. */
  readonly value: string | number | null;
};

export type Walkthrough = {
  readonly projectId: string;
  readonly subject: PartialSubject;
  readonly status: string;
  readonly steps: readonly StepState[];
  /** Required steps still empty. Empty means the film can be started. */
  readonly missing: readonly string[];
};

export type Failure = { readonly ok: false; readonly error: string };

/**
 * Under this, it is not an answer — it is somebody saying "um" and stopping.
 *
 * An absolute floor, deliberately low. Everything above it is judged against
 * the person's OWN pace rather than a number invented here, because "What is
 * your name?" really is a four-second answer and being nagged about it would
 * be worse than a short film.
 */
const TOO_SHORT_SECONDS = 3;

/** How far below their own middle an answer falls before it is worth saying. */
const OUTLIER_SHARE = 0.35;

/** Below this there is not enough of a pattern to call anything an outlier. */
const ENOUGH_TO_COMPARE_SECONDS = 10;

/**
 * The middle of what this person says, so a short answer is measured against
 * them and not against a stranger.
 *
 * The median rather than the mean: one long answer should not make every
 * other answer look thin.
 */
export const medianSeconds = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

export type SpokenVerdict = "inaudible" | "short" | "clear";

/**
 * What to say about the length of one answer, while the camera is still up.
 *
 * A film is as long as the answers in it, and a four-second answer cannot be
 * rescued by any amount of editing — but it can be recorded again in the
 * thirty seconds after somebody notices. This is the only moment the problem
 * is solvable, which is the whole reason ingest runs during capture.
 *
 * Relative to the person, not to a target. Somebody whose every answer is
 * eight seconds is having a short-answer conversation and should be left
 * alone; somebody who has been giving thirty-second answers and then gives
 * four has probably been interrupted, and would want to know.
 *
 * A decision, so it lives here where it is tested, rather than in the web app
 * where the wording lives.
 */
export const spokenVerdict = (
  seconds: number,
  theirMedianSeconds: number,
): SpokenVerdict => {
  if (seconds < 2) return "inaudible";
  if (seconds < TOO_SHORT_SECONDS) return "short";
  if (
    theirMedianSeconds >= ENOUGH_TO_COMPARE_SECONDS &&
    seconds < theirMedianSeconds * OUTLIER_SHARE
  ) {
    return "short";
  }
  return "clear";
};

/* ── starting ─────────────────────────────────────────────────────────── */

/**
 * A project exists before anyone has said who it is about.
 *
 * The first thing after Start is choosing what kind of film to make, so at
 * this moment there is no name, no age and no address — subject_data starts as
 * the empty object and the detail steps fill it in. The project lands in
 * `capturing`, which the dispatcher's ACTIVE list deliberately excludes, so
 * nothing is planned until the walk-through hands it over.
 */
/**
 * How many films one person may have on the go at once.
 *
 * Generous — nobody is making a tenth family film this afternoon — and it is
 * here because pressing Start needs no account and no payment. Without a
 * ceiling, one visitor holding one session can write rows for as long as they
 * care to, and the first anyone would know is the bill.
 */
export const MAX_UNFINISHED_FILMS = 10;

export const startCapture = async (
  deps: CaptureDeps,
  input: { readonly ownerId: string; readonly templateId: string; readonly templateVersion: number },
): Promise<{ ok: true; projectId: string } | Failure> => {
  try {
    getTemplate(input.templateId, input.templateVersion);
  } catch {
    // The id came over the wire from a chooser form; refusing beats throwing.
    return { ok: false, error: "no such kind of film" };
  }

  const unfinished = await deps.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.ownerId, input.ownerId), eq(projects.status, "capturing")))
    .limit(MAX_UNFINISHED_FILMS);
  if (unfinished.length >= MAX_UNFINISHED_FILMS) {
    return {
      ok: false,
      error: "You have several films on the go already — finish or delete one before starting another.",
    };
  }
  const projectId = randomUUID();
  await deps.db.insert(projects).values({
    id: projectId,
    ownerId: input.ownerId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    subjectData: {},
    config: { questionPrompts: [] },
    status: "capturing",
  });
  return { ok: true, projectId };
};

/**
 * The application's user row for an address, created on demand.
 *
 * Intake's shape: a row keyed by a lower-cased address, so sign-in later finds
 * it by the address the identity provider verified and the films made before
 * the first sign-in stay owned by the person who made them.
 */
/**
 * An owner row with no address and no identity, for a server with no auth
 * configured at all. The offline path stays first-class: `pnpm web` against
 * nothing but Postgres can still make a film, and the row is exactly what an
 * anonymous sign-in would have produced minus the identity to link later.
 */
export const ensureAnonymousOwner = async (db: Db): Promise<string> => {
  const id = randomUUID();
  await db.insert(users).values({ id, email: null });
  return id;
};

export const ensureOwner = async (db: Db, rawEmail: string): Promise<string> => {
  const email = rawEmail.trim().toLowerCase();
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

  const subject = project.subjectData as PartialSubject;
  const template = getTemplate(project.templateId, project.templateVersion);
  const captured = await deps.db.select().from(assets).where(eq(assets.projectId, projectId));

  const steps: StepState[] = resolveCaptureSteps(template, subject).map((step) => {
    if (step.kind === "detail") {
      const field = step.field as DetailField;
      // The owner's address lives on the project, not in the subject: it is
      // delivery metadata, and users.email is reserved for verified identity.
      const value =
        field.target === "owner"
          ? project.deliverTo
          : ((subject as Record<string, string | number | undefined>)[field.id] ?? null);
      return { ...step, asset: null, value };
    }

    const row = captured.find((a) =>
      step.kind === "question" ? a.questionId === step.questionId : a.slotId === step.slotId,
    );
    return {
      ...step,
      value: null,
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
              thumbnailKey: row.thumbnailKey,
              contentType: row.contentType,
              ingested: row.normalisedKey !== null,
              warnings: (row.warnings ?? []) as { code: string; message: string }[],
              speechSeconds: speechSecondsOf(row.qcMetrics),
            },
    };
  });

  return {
    projectId,
    subject,
    status: project.status,
    steps,
    missing: steps
      .filter((s) => s.required && s.asset === null && (s.value === null || s.value === ""))
      .map((s) => s.id),
  };
};

/** Total speech ingest heard, from the runs it measured on the original. */
const speechSecondsOf = (qcMetrics: unknown): number | null => {
  const runs = (qcMetrics as { speechRuns?: { startMs: number; endMs: number }[] } | null)
    ?.speechRuns;
  if (runs === undefined) return null;
  return runs.reduce((sum, r) => sum + (r.endMs - r.startMs), 0) / 1000;
};

/* ── details ──────────────────────────────────────────────────────────── */

/**
 * One typed answer, validated against the template's own field and merged in.
 *
 * The value arrives as a string because it came out of an input; the field's
 * kind decides what it must parse to. Everything refusable is refused here —
 * the step sheet shows the sentence, and nothing downstream should ever meet
 * an age of "ninety-four".
 */
export type SavedDetail = {
  readonly ok: true;
  /** What kind of thing was saved — the caller that fires a sign-in link when
   *  an owner address lands needs to know without a second query. */
  readonly target: "subject" | "owner";
  /** The canonical stored value, post-trim and lower-casing. */
  readonly value: string | number | null;
  /**
   * Whether this actually differs from what was already stored.
   *
   * Load-bearing for the address: saving it is what sends a sign-in email, and
   * without this every re-save of the same address sends another one — which
   * is a way to mail-bomb a stranger through our server, and a way to burn the
   * mail quota, using nothing but a project anyone can create.
   */
  readonly changed: boolean;
};

export const saveDetail = async (
  deps: CaptureDeps,
  input: { readonly projectId: string; readonly fieldId: string; readonly value: string },
): Promise<SavedDetail | Failure> => {
  const walkthrough = await loadWalkthrough(deps, input.projectId);
  if (walkthrough === null) return { ok: false, error: "no such project" };
  if (walkthrough.status !== "capturing") {
    return { ok: false, error: "this film has already been started" };
  }
  const step = walkthrough.steps.find((s) => s.kind === "detail" && s.id === input.fieldId);
  const field = step?.field;
  if (step === undefined || field === undefined) {
    return { ok: false, error: `no detail "${input.fieldId}"` };
  }

  const raw = input.value.trim();
  if (raw === "") {
    // Clearing an answer is allowed the way removing a take is: an optional
    // one goes quietly, a required one goes back to "missing".
    return clearDetail(deps, input.projectId, field);
  }
  if (raw.length > 200) return { ok: false, error: "that is too long" };

  let value: string | number;
  if (field.kind === "number") {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) return { ok: false, error: "that needs to be a whole number" };
    if (parsed < (field.min ?? 1) || parsed > (field.max ?? Number.MAX_SAFE_INTEGER)) {
      return { ok: false, error: "that number does not look right" };
    }
    value = parsed;
  } else if (field.kind === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return { ok: false, error: "that does not look like an email address" };
    }
    value = raw.toLowerCase();
  } else {
    value = raw;
  }

  if (field.target === "owner") {
    const changed = step.value !== value;
    await deps.db
      .update(projects)
      .set({ deliverTo: value as string, updatedAt: new Date() })
      .where(eq(projects.id, input.projectId));
    return { ok: true, target: "owner", value, changed };
  }

  const subject: Record<string, string | number> = {
    ...(walkthrough.subject as Record<string, string | number>),
    [field.id]: value,
  };
  // "Who is this film for?" also answers "what do you call them?" until the
  // customer says otherwise on the optional step.
  for (const prefill of field.prefills ?? []) {
    subject[prefill] ??= value;
  }

  await deps.db
    .update(projects)
    .set({ subjectData: subject, updatedAt: new Date() })
    .where(eq(projects.id, input.projectId));
  return { ok: true, target: "subject", value, changed: step.value !== value };
};

const clearDetail = async (
  deps: CaptureDeps,
  projectId: string,
  field: DetailField,
): Promise<SavedDetail> => {
  if (field.target === "owner") {
    await deps.db
      .update(projects)
      .set({ deliverTo: null, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    // Nothing to announce and nothing to send: clearing is not an address.
    return { ok: true, target: "owner", value: null, changed: false };
  }
  const rows = await deps.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const project = rows[0];
  if (project !== undefined) {
    const subject = { ...(project.subjectData as Record<string, unknown>) };
    delete subject[field.id];
    await deps.db
      .update(projects)
      .set({ subjectData: subject, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }
  return { ok: true, target: "subject", value: null, changed: false };
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
