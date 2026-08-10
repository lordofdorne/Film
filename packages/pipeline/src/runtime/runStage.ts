import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  claimStage,
  completeStage,
  failStage,
  shouldRetry,
  type Db,
  type FailureClass,
  type StageIdentity,
} from "@film/db";
import { STAGE_POLICY, type QueueName } from "@film/queue";
import type { ObjectStore } from "@film/storage";

import { cancelled, classify, sanitise, transient } from "./errors.js";
import { createStageLog, type StageLog } from "./log.js";
import { hasFreeSpace, workRoot } from "./workdir.js";

/** Everything a stage is handed. Nothing here knows about pg-boss. */
export type StageContext = {
  readonly db: Db;
  readonly store: ObjectStore;
  readonly projectId: string;
  readonly assetId: string | null;
  readonly executionId: string;
  readonly attempt: number;
  readonly log: StageLog;
  /**
   * A private scratch directory, created on first call and removed when the
   * stage returns. Lazy because compose and deliver never touch the disk, and
   * a stage that needs no space should not create any.
   */
  scratch(): Promise<string>;
  /**
   * Fires when the stage's time is up or the worker is draining.
   *
   * Racing a promise against a timeout does not stop the work — FFmpeg and
   * Chrome are child processes and keep running regardless. Passing this
   * signal into them is what actually reclaims the worker, so a stage that
   * spawns anything must hand it on.
   */
  readonly signal: AbortSignal;
};

export type StageOutcome =
  | { readonly status: "succeeded"; readonly outputHash: string | null }
  | { readonly status: "skipped"; readonly reason: "already_done" | "in_flight" }
  | { readonly status: "deferred"; readonly reason: "insufficient_disk" }
  | {
      readonly status: "failed";
      readonly failureClass: FailureClass;
      readonly error: string;
      readonly willRetry: boolean;
    };

export type RunStageOptions = {
  /** Refuse to claim unless this much scratch space is free. */
  readonly requiresFreeBytes?: number;
  /** Defaults to the queue's expiry for this stage. */
  readonly timeoutMs?: number;
  /** Fires when the worker is draining; aborts the stage and its children. */
  readonly parentSignal?: AbortSignal;
  readonly maxAttempts?: number;
};

/**
 * Claim a stage, do the work, record what happened. In that order, always.
 *
 * The claim is an insert against a unique constraint, so a duplicate delivery
 * loses the race and is told so rather than repeating minutes of render. That
 * guarantee belongs to Postgres, not to us — see claimStage.
 *
 * Every exit from this function writes a terminal row status. A stage that
 * throws, times out or is abandoned mid-flight must not be left `running`,
 * because `running` is exactly what the reconciler reads as "a worker is on
 * it" — and it would then wait out the whole stall threshold for nothing.
 */
export const runStage = async (
  deps: { readonly db: Db; readonly store: ObjectStore },
  identity: StageIdentity,
  options: RunStageOptions,
  work: (ctx: StageContext) => Promise<string | null>,
): Promise<StageOutcome> => {
  const { db, store } = deps;

  /**
   * Checked before claiming, not after.
   *
   * Claiming and then finding there is no room writes a failed attempt against
   * a stage that is perfectly fine, and spends one of its retries on a
   * condition belonging to this container rather than to the work. Deferring
   * instead puts the job back for a worker that has room.
   */
  if (options.requiresFreeBytes !== undefined && !(await hasFreeSpace(options.requiresFreeBytes))) {
    return { status: "deferred", reason: "insufficient_disk" };
  }

  const claim = await claimStage(db, identity);
  if (!claim.claimed) return { status: "skipped", reason: claim.reason };

  const log = createStageLog(
    db,
    claim.executionId,
    `[${identity.stage} ${identity.projectId.slice(0, 8)}]`,
  );

  const timeoutMs =
    options.timeoutMs ?? STAGE_POLICY[identity.stage as QueueName].expireInSeconds * 1000;

  // Two ways to be interrupted, told apart because they mean different things:
  // running out of time is the work's problem and worth retrying, whereas a
  // drain is ours and should not count against the work.
  const controller = new AbortController();
  let interruption: "timeout" | "drain" | null = null;
  const drain = (): void => {
    interruption ??= "drain";
    controller.abort(new Error("worker draining"));
  };
  options.parentSignal?.addEventListener("abort", drain, { once: true });
  const timer = setTimeout(() => {
    interruption ??= "timeout";
    controller.abort(new Error(`stage exceeded ${String(Math.round(timeoutMs / 1000))}s`));
  }, timeoutMs);

  let scratchDir: string | null = null;

  try {
    const started = Date.now();
    await log.info(`started (attempt ${String(claim.attempt)})`);

    const outputHash = await work({
      db,
      store,
      projectId: identity.projectId,
      assetId: identity.assetId ?? null,
      executionId: claim.executionId,
      attempt: claim.attempt,
      log,
      signal: controller.signal,
      scratch: async () => {
        scratchDir ??= await mkdtemp(join(workRoot(), `film-${identity.stage}-`));
        return scratchDir;
      },
    });

    await completeStage(db, claim.executionId, outputHash);
    await log.info(`succeeded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { status: "succeeded", outputHash };
  } catch (error: unknown) {
    const staged =
      interruption === "drain"
        ? cancelled("interrupted by a worker shutdown", error)
        : interruption === "timeout"
          ? transient(`timed out after ${String(Math.round(timeoutMs / 1000))}s`, error)
          : classify(error);

    const summary = sanitise(staged.summary);
    const willRetry = shouldRetry(staged.failureClass, claim.attempt, options.maxAttempts);

    await failStage(db, claim.executionId, staged.failureClass, summary);
    await log.error(`failed (${staged.failureClass}): ${summary}`, {
      willRetry,
      attempt: claim.attempt,
      // Full detail lands here, where an operator can read it, and not on the
      // row that a customer-facing surface is most likely to render.
      detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    return { status: "failed", failureClass: staged.failureClass, error: summary, willRetry };
  } finally {
    clearTimeout(timer);
    options.parentSignal?.removeEventListener("abort", drain);
    // Cleanup swallows its own error on purpose: a stage that failed has
    // already produced the interesting exception, and losing it behind an
    // unlink failure would be a bad trade. Boot sweeps whatever survives.
    if (scratchDir !== null) {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
};
