/**
 * The pipeline: what each stage of the film actually does.
 *
 * Everything here is a function of (database, object store, job) and nothing
 * here knows about pg-boss, HTTP or process lifecycle. That separation is the
 * point — the queue is an accelerator, not the source of truth, and a stage
 * must be runnable directly from a script when the queue is down or when
 * someone is debugging one project by hand.
 *
 * apps/worker is the thin process that wires this to pg-boss and to signals.
 */
export * from "./media/ffmpeg.js";
export * from "./media/loudness.js";
export * from "./media/musicBed.js";
export * from "./compose/plan.js";
export * from "./render/webpack.js";
export * from "./runtime/errors.js";
export * from "./runtime/log.js";
export * from "./runtime/runStage.js";
export * from "./runtime/workdir.js";
export * from "./model.js";
export * from "./stages/context.js";
export * from "./stages/ingest.js";
export * from "./stages/compose.js";
