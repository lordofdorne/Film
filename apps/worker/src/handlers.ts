import type { Db } from "@film/db";
import { JobPayloadSchema, type QueueName } from "@film/queue";
import type { ObjectStore } from "@film/storage";
import {
  ingestRequiresFreeBytes,
  permanent,
  RENDER_REQUIRES_FREE_BYTES,
  runCompose,
  runDeliver,
  runIngest,
  runRender,
  runStage,
  runThumbnail,
  runTranscribe,
  thumbnailRequiresFreeBytes,
  transcribeRequiresFreeBytes,
  type StageOutcome,
} from "@film/pipeline";

export type HandlerDeps = {
  readonly db: Db;
  readonly store: ObjectStore;
  /** Aborts everything in flight when the worker is draining. */
  readonly signal: AbortSignal;
};

/**
 * Stages this worker will actually run.
 *
 * qc and select have queues and database enum values but no implementation,
 * and they are deliberately absent here rather than present as no-ops. A stage
 * that succeeds without doing anything is indistinguishable from a stage that
 * works, which is precisely the wrong thing to be unsure about later.
 */
export const IMPLEMENTED: readonly QueueName[] = [
  "ingest",
  "transcribe",
  "thumbnail",
  "compose",
  "render",
  "deliver",
];

/**
 * Run one job.
 *
 * Everything about claiming, timing out, classifying failure and cleaning up
 * is runStage's business. This decides only which function to call and how
 * much disk it needs first.
 */
export const handleJob = async (deps: HandlerDeps, raw: unknown): Promise<StageOutcome> => {
  const job = JobPayloadSchema.parse(raw);
  const identity = {
    projectId: job.projectId,
    assetId: job.assetId ?? null,
    stage: job.stage,
    inputHash: job.inputHash,
  };
  const common = { parentSignal: deps.signal };

  switch (job.stage) {
    case "ingest":
      return runStage(
        deps,
        identity,
        { ...common, requiresFreeBytes: ingestRequiresFreeBytes() },
        runIngest,
      );

    case "transcribe":
      return runStage(
        deps,
        identity,
        { ...common, requiresFreeBytes: transcribeRequiresFreeBytes() },
        runTranscribe,
      );

    case "thumbnail":
      return runStage(
        deps,
        identity,
        { ...common, requiresFreeBytes: thumbnailRequiresFreeBytes() },
        runThumbnail,
      );

    case "compose":
      return runStage(deps, identity, common, runCompose);

    case "render": {
      const renderId = job.renderId;
      if (renderId === undefined) {
        throw new Error("a render job arrived without a render id");
      }
      return runStage(
        deps,
        identity,
        { ...common, requiresFreeBytes: RENDER_REQUIRES_FREE_BYTES },
        async (ctx) => runRender(ctx, renderId),
      );
    }

    case "deliver": {
      const renderId = job.renderId;
      if (renderId === undefined) {
        throw new Error("a deliver job arrived without a render id");
      }
      return runStage(deps, identity, common, async (ctx) => runDeliver(ctx, renderId));
    }

    case "qc":
    case "select":
      return runStage(deps, identity, common, async () => {
        throw permanent(`the ${job.stage} stage is not implemented yet`);
      });
  }
};
