import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "./connection.js";
import { stageExecutions } from "./schema/tables.js";

export type StageName =
  | "ingest"
  | "qc"
  | "transcribe"
  | "select"
  | "compose"
  | "render"
  | "deliver";

export type FailureClass = "permanent" | "transient" | "cancelled";

export type StageIdentity = {
  readonly projectId: string;
  /** Null for project-wide stages: compose, render, deliver. */
  readonly assetId?: string | null;
  readonly stage: StageName;
  readonly inputHash: string;
};

/**
 * The content hash of everything a stage consumes.
 *
 * Sorted keys so JSON key order cannot change the hash, and the template
 * version and format id are part of it — a template change must invalidate
 * cached work, or an old render silently survives a new template.
 */
export const hashInputs = (inputs: Record<string, unknown>): string => {
  const canonical = JSON.stringify(inputs, Object.keys(inputs).sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
};

export type ClaimResult =
  | { readonly claimed: true; readonly executionId: string; readonly attempt: number }
  | { readonly claimed: false; readonly reason: "already_done" | "in_flight"; readonly executionId: string };

/**
 * Claim a stage, then do the work — never the other way round.
 *
 * The unique constraint on (project_id, asset_id, stage, input_hash) is what
 * makes this exactly-once. A duplicate delivery loses the insert race and is
 * told so; it does not repeat the work. Postgres enforces this, not a lock we
 * hold and hope to release.
 *
 * A previously FAILED row is re-claimable — that is a retry, and it bumps the
 * attempt counter rather than inserting a second row, so the history of a
 * flaky stage stays on one row instead of scattering.
 */
export const claimStage = async (db: Db, identity: StageIdentity): Promise<ClaimResult> => {
  const assetId = identity.assetId ?? null;

  const inserted = await db
    .insert(stageExecutions)
    .values({
      projectId: identity.projectId,
      assetId,
      stage: identity.stage,
      inputHash: identity.inputHash,
      status: "running",
      attempt: 1,
      startedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: stageExecutions.id, attempt: stageExecutions.attempt });

  const won = inserted[0];
  if (won !== undefined) {
    return { claimed: true, executionId: won.id, attempt: won.attempt };
  }

  // Lost the race, or this is a retry of a row that already exists.
  const existing = await db
    .select()
    .from(stageExecutions)
    .where(
      and(
        eq(stageExecutions.projectId, identity.projectId),
        assetId === null
          ? isNull(stageExecutions.assetId)
          : eq(stageExecutions.assetId, assetId),
        eq(stageExecutions.stage, identity.stage),
        eq(stageExecutions.inputHash, identity.inputHash),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (row === undefined) {
    throw new Error(
      `stage ${identity.stage} conflicted on insert but no row was found — ` +
        "the unique index and this query disagree about identity",
    );
  }

  if (row.status === "succeeded") {
    return { claimed: false, reason: "already_done", executionId: row.id };
  }
  if (row.status === "running" || row.status === "claimed") {
    return { claimed: false, reason: "in_flight", executionId: row.id };
  }

  // status === "failed" — a retry. Re-claim it and count the attempt.
  const retried = await db
    .update(stageExecutions)
    .set({
      status: "running",
      attempt: sql`${stageExecutions.attempt} + 1`,
      error: null,
      failureClass: null,
      startedAt: new Date(),
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(stageExecutions.id, row.id), eq(stageExecutions.status, "failed")))
    .returning({ id: stageExecutions.id, attempt: stageExecutions.attempt });

  const claimedRow = retried[0];
  return claimedRow === undefined
    ? { claimed: false, reason: "in_flight", executionId: row.id }
    : { claimed: true, executionId: claimedRow.id, attempt: claimedRow.attempt };
};

/**
 * Give every dead end in one project another go.
 *
 * The dispatcher refuses to hand out a stage that failed permanently or has
 * used up its attempts — rightly, or it and the runner would argue for ever
 * and the loop would read like progress. But that leaves a customer looking at
 * a film that cannot move, with nothing to press.
 *
 * So: reset the counter and clear the verdict, and leave everything else
 * exactly as it is. The error text stays on the row, because the next person
 * to look at this project wants to know what happened the first time. The
 * claim protocol already knows how to re-claim a failed row and count the
 * attempt, so nothing here has to understand claiming.
 *
 * What it deliberately does NOT do is delete anything. A retry that erased the
 * evidence would make the second failure look like the first.
 */
export const reopenFailedStages = async (db: Db, projectId: string): Promise<number> => {
  const reopened = await db
    .update(stageExecutions)
    .set({ attempt: 0, failureClass: null, updatedAt: new Date() })
    .where(and(eq(stageExecutions.projectId, projectId), eq(stageExecutions.status, "failed")))
    .returning({ id: stageExecutions.id });
  return reopened.length;
};

export const completeStage = async (
  db: Db,
  executionId: string,
  outputHash: string | null,
): Promise<void> => {
  await db
    .update(stageExecutions)
    .set({
      status: "succeeded",
      outputHash,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(stageExecutions.id, executionId));
};

export const failStage = async (
  db: Db,
  executionId: string,
  failureClass: FailureClass,
  error: string,
): Promise<void> => {
  await db
    .update(stageExecutions)
    .set({
      status: "failed",
      failureClass,
      // Sanitised upstream; never a raw stack trace a customer could see.
      error: error.slice(0, 4000),
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(stageExecutions.id, executionId));
};

/**
 * Work that started and never finished.
 *
 * This is what the reconciler sweeps. It covers the case the queue cannot: the
 * transaction committed but the queue insert never landed, or a worker was
 * killed mid-stage. Postgres rows are authoritative, so remaining work is
 * reconstructible from here with the queue empty.
 */
export const findStalledStages = async (
  db: Db,
  olderThanMs: number,
  limit = 100,
): Promise<{ id: string; projectId: string; stage: StageName; attempt: number }[]> => {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .select({
      id: stageExecutions.id,
      projectId: stageExecutions.projectId,
      stage: stageExecutions.stage,
      attempt: stageExecutions.attempt,
    })
    .from(stageExecutions)
    .where(and(eq(stageExecutions.status, "running"), lt(stageExecutions.updatedAt, cutoff)))
    .limit(limit);
  return rows;
};

/**
 * Whether a failure is worth retrying.
 *
 * Corrupt media will be just as corrupt on the fourth attempt, and retrying it
 * burns a worker and delays the queue. A provider timeout usually will not
 * recur. Getting this wrong in either direction is expensive, so the
 * classification is explicit rather than inferred from an error string.
 */
export const shouldRetry = (failureClass: FailureClass, attempt: number, maxAttempts = 4): boolean =>
  failureClass === "transient" && attempt < maxAttempts;
