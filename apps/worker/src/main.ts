/**
 * The worker.
 *
 *   pnpm worker
 *
 * Deliberately thin. It starts pg-boss, subscribes each implemented stage at
 * its own concurrency, runs a periodic tick that turns database state into
 * jobs, and drains on SIGTERM. Everything about what a stage DOES lives in
 * @film/pipeline, which knows nothing about queues or signals — so a stage can
 * be run straight from a script when the queue is down or when someone is
 * debugging one project by hand.
 *
 * Run as many of these as you like. Exactly-once is enforced by a unique
 * constraint in Postgres, not by there being one process.
 */
import { createDb } from "@film/db";
import {
  consoleLog,
  dispatchActiveProjects,
  reconcileStalledStages,
  sweepAbandonedWorkdirs,
} from "@film/pipeline";
import { createQueue, ensureQueues, enqueueStage, STAGE_POLICY } from "@film/queue";
import { storeFromEnv } from "@film/storage";

import { handleJob, IMPLEMENTED } from "./handlers.js";

const log = consoleLog("[worker]");

/** How often database state is turned into queue jobs. */
const TICK_MS = Number(process.env["WORKER_TICK_MS"] ?? 5_000);

/** How long to let work finish after SIGTERM before giving up on it. */
const DRAIN_MS = Number(process.env["WORKER_DRAIN_MS"] ?? 30_000);

const main = async (): Promise<void> => {
  const connectionString = process.env["DATABASE_URL_WORKER"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL_WORKER is not set");
  }

  // createDb refuses a transaction-pooled URL for this role. pg-boss needs
  // session state and LISTEN/NOTIFY, and through a pooler jobs are silently
  // never delivered — which is close to undiagnosable in production.
  const { db, pool } = createDb("worker");
  const store = storeFromEnv();

  const swept = await sweepAbandonedWorkdirs();
  if (swept > 0) await log.info(`removed ${String(swept)} scratch directories from a previous run`);

  const boss = createQueue({ connectionString });
  boss.on("error", (error: unknown) => {
    void log.error(`queue error: ${String(error)}`);
  });
  await boss.start();
  await ensureQueues(boss);

  /**
   * Draining, not stopping dead.
   *
   * A container being replaced during a deploy is the normal case, not an
   * incident. In-flight work gets DRAIN_MS to finish; anything still running
   * is aborted, and runStage records it as cancelled rather than as a failure
   * of the work — otherwise every rolling deploy reads as a pipeline full of
   * flaky stages.
   */
  const draining = new AbortController();
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      void log.warn(`${signal} again — exiting now`);
      process.exit(1);
    }
    shuttingDown = true;
    void (async () => {
      await log.info(`${signal} — draining for up to ${String(DRAIN_MS / 1000)}s`);
      clearInterval(ticker);
      const deadline = setTimeout(() => {
        void log.warn("drain deadline reached — aborting work still in flight");
        draining.abort(new Error("drain deadline"));
      }, DRAIN_MS);

      try {
        /**
         * stop() returns before the workers have finished; pg-boss signals
         * completion with a "stopped" event. Awaiting only the call would end
         * the process with jobs still running, which is the opposite of a
         * drain — so wait for the event, bounded by the same deadline.
         */
        const stopped = new Promise<void>((resolve) => boss.once("stopped", () => { resolve(); }));
        await boss.stop({ graceful: true, timeout: DRAIN_MS });
        await Promise.race([stopped, new Promise((r) => setTimeout(r, DRAIN_MS))]);
      } catch (error: unknown) {
        await log.warn(`queue did not stop cleanly: ${String(error)}`);
      }
      clearTimeout(deadline);
      draining.abort(new Error("shutdown"));
      await pool.end().catch(() => undefined);
      await log.info("stopped");
      process.exit(0);
    })();
  };

  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
  process.on("SIGINT", () => { shutdown("SIGINT"); });

  const deps = { db, store, signal: draining.signal };

  for (const stage of IMPLEMENTED) {
    const policy = STAGE_POLICY[stage];
    await boss.work(
      stage,
      { batchSize: policy.concurrency, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const outcome = await handleJob(deps, job.data);
          /**
           * A deferred job is thrown back, not failed.
           *
           * This container has no disk right now. Throwing returns the job to
           * pg-boss, which retries it with backoff and may well hand it to a
           * worker that has room.
           */
          if (outcome.status === "deferred") {
            throw new Error(`deferred: ${outcome.reason}`);
          }
        }
      },
    );
  }
  await log.info(
    `subscribed to ${IMPLEMENTED.join(", ")} ` +
      `(concurrency ${IMPLEMENTED.map((s) => `${s}=${String(STAGE_POLICY[s].concurrency)}`).join(" ")})`,
  );

  /**
   * The tick: database state in, jobs out.
   *
   * Both halves are recovery paths that run constantly rather than only after
   * an incident. The dispatcher covers a stage that finished and failed to
   * enqueue its successor; the reconciler covers a worker that was killed
   * mid-stage and left its row saying `running` forever.
   */
  let ticking = false;
  const tick = async (): Promise<void> => {
    if (ticking || shuttingDown) return;
    ticking = true;
    try {
      const { swept: stalled } = await reconcileStalledStages(db);
      if (stalled > 0) await log.warn(`swept ${String(stalled)} stalled stage(s)`);

      const result = await dispatchActiveProjects(db, async (job) => enqueueStage(boss, job));
      if (result.jobsEnqueued > 0) {
        await log.info(
          `dispatched ${String(result.jobsEnqueued)} job(s) across ` +
            `${String(result.projectsSeen)} active project(s)`,
        );
      }
      if (result.projectsBlocked > 0) {
        await log.warn(`${String(result.projectsBlocked)} project(s) can make no further progress`);
      }
    } catch (error: unknown) {
      // A tick that throws must not kill the worker. The next one will try
      // again, and the state it reads from is unchanged.
      await log.error(`tick failed: ${String(error)}`);
    } finally {
      ticking = false;
    }
  };

  const ticker = setInterval(() => { void tick(); }, TICK_MS);
  await log.info(`ready — dispatching every ${String(TICK_MS / 1000)}s`);
  await tick();
};

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
