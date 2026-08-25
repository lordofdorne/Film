import { PgBoss } from "pg-boss";
import { z } from "zod";

/**
 * pg-boss is a queue, NOT the source of truth.
 *
 * Postgres rows in stage_executions are authoritative. If this queue is
 * drained, corrupted or rebuilt from scratch, the reconciler reconstructs the
 * remaining work from those rows. Nothing here may be the only record that a
 * piece of work needs doing.
 */
export const QUEUES = [
  "ingest",
  "qc",
  "transcribe",
  "select",
  "compose",
  "render",
  "deliver",
  "thumbnail",
] as const;

export type QueueName = (typeof QUEUES)[number];

/** Every job carries the same shape, so a worker never guesses at a payload. */
export const JobPayloadSchema = z
  .object({
    projectId: z.string().uuid(),
    /** Absent for project-wide stages: compose, render, deliver. */
    assetId: z.string().uuid().optional(),
    stage: z.enum(QUEUES),
    /** Content hash of the stage's inputs — the exactly-once key. */
    inputHash: z.string().min(8).max(64),
    /**
     * Which render row this job is for. Present on render and deliver only.
     *
     * Carried rather than looked up: a project can have two delivery renders
     * outstanding — one per approved cut — and "find the queued one" is
     * ambiguous exactly when it matters.
     */
    renderId: z.string().uuid().optional(),
    attempt: z.number().int().positive().default(1),
  })
  .strict();

export type JobPayload = z.infer<typeof JobPayloadSchema>;

/**
 * Per-stage policy.
 *
 * These differ by an order of magnitude for good reasons: a render holds a
 * browser for minutes and must not be retried lightly, while a transcription
 * call is cheap to repeat and usually fails transiently.
 */
export type StagePolicy = {
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly expireInSeconds: number;
  /** How many of this stage one worker process runs at once. */
  readonly concurrency: number;
};

export const STAGE_POLICY: Readonly<Record<QueueName, StagePolicy>> = {
  ingest: { retryLimit: 3, retryDelaySeconds: 30, expireInSeconds: 900, concurrency: 2 },
  qc: { retryLimit: 3, retryDelaySeconds: 20, expireInSeconds: 300, concurrency: 4 },
  transcribe: { retryLimit: 4, retryDelaySeconds: 60, expireInSeconds: 900, concurrency: 4 },
  select: { retryLimit: 4, retryDelaySeconds: 30, expireInSeconds: 300, concurrency: 4 },
  compose: { retryLimit: 2, retryDelaySeconds: 15, expireInSeconds: 300, concurrency: 2 },
  // Concurrency 1 per container to start. Each render holds a Chrome instance
  // whose memory grows with the film; two in one container is how you get an
  // OOM kill two thirds of the way through.
  render: { retryLimit: 2, retryDelaySeconds: 120, expireInSeconds: 3600, concurrency: 1 },
  deliver: { retryLimit: 5, retryDelaySeconds: 60, expireInSeconds: 300, concurrency: 4 },
  // One frame and a downscale. The only slow part is fetching the media it
  // reads from, which is why several run at once.
  thumbnail: { retryLimit: 3, retryDelaySeconds: 30, expireInSeconds: 300, concurrency: 4 },
};

/**
 * pg-boss owns its own tables in its own schema, and Drizzle never touches
 * them. Keeping them out of `public` is what makes that boundary visible
 * rather than a convention someone has to remember.
 */
export const PGBOSS_SCHEMA = "pgboss";

export type QueueOptions = {
  /** MUST be a session-mode or direct connection. See @film/db. */
  readonly connectionString: string;
  readonly schema?: string;
};

export const createQueue = (options: QueueOptions): PgBoss =>
  new PgBoss({
    connectionString: options.connectionString,
    schema: options.schema ?? PGBOSS_SCHEMA,
    // A worker that dies mid-job should have its job returned to the queue
    // promptly rather than waiting out a long lease.
    maintenanceIntervalSeconds: 60,
  });

/** Create every queue with its policy. Idempotent — safe on every boot. */
export const ensureQueues = async (boss: PgBoss): Promise<void> => {
  for (const name of QUEUES) {
    const policy = STAGE_POLICY[name];
    await boss.createQueue(name, {
      /**
       * "short" keeps at most one job per singletonKey in the created state.
       *
       * Without it the queue's default policy is "standard", which does no
       * deduplication at all — verified: two identical enqueues both returned
       * job ids. The database constraint would still have caught the duplicate
       * at claim time, so correctness never depended on this, but the work of
       * queueing and dequeuing it was pure waste.
       */
      policy: "short",
      retryLimit: policy.retryLimit,
      retryDelay: policy.retryDelaySeconds,
      retryBackoff: true,
      expireInSeconds: policy.expireInSeconds,
    });
  }
};

/**
 * Enqueue a stage.
 *
 * The singleton key mirrors the stage_executions unique constraint, so a
 * duplicate enqueue collapses in the queue as well as in the database. Belt
 * and braces: the database is what guarantees correctness, this just avoids
 * doing pointless work before finding that out.
 */
export const enqueueStage = async (
  boss: PgBoss,
  payload: JobPayload,
): Promise<string | null> => {
  const parsed: JobPayload = JobPayloadSchema.parse(payload);
  const key = [parsed.projectId, parsed.assetId ?? "-", parsed.stage, parsed.inputHash].join(":");
  return boss.send(parsed.stage, parsed, {
    singletonKey: key,
    retryLimit: STAGE_POLICY[parsed.stage].retryLimit,
  });
};

export { PgBoss };
