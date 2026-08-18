import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";

import {
  approvals,
  edlVersions,
  failStage,
  findStalledStages,
  projects,
  renders,
  stageExecutions,
  type Db,
  type StageIdentity,
  type StageName,
} from "@film/db";
import { getFormat } from "@film/formats";
import { STAGE_POLICY, type JobPayload } from "@film/queue";
import { getTemplate } from "@film/templates";

import { composeIdentity } from "./stages/compose.js";
import { loadAssets, loadProject } from "./stages/context.js";
import { ingestIdentity } from "./stages/ingest.js";
import { renderIdentity } from "./stages/render.js";
import { deliverIdentity } from "./stages/deliver.js";

/**
 * How many times a stage may be attempted before the project is stuck.
 *
 * Shared by the runner (which decides whether to offer a retry) and the
 * dispatcher (which decides whether to hand the work out again). Two different
 * numbers here would give a stage that the runner has given up on and the
 * dispatcher keeps re-queueing — a loop that looks like progress.
 */
export const MAX_ATTEMPTS = 4;

/**
 * Project states in which there may still be work to do.
 *
 * `capturing` is here so ingest runs while the camera is still up: "we could
 * barely hear that one" is actionable while the customer is standing there
 * able to record again, and useless at approval, hours after they went home.
 */
const ACTIVE = ["capturing", "processing", "awaiting_approval", "approved", "rendering"] as const;

type ExecutionRow = typeof stageExecutions.$inferSelect;

const keyOf = (stage: StageName, assetId: string | null, inputHash: string): string =>
  `${stage}:${assetId ?? "-"}:${inputHash}`;

const identityKey = (identity: StageIdentity): string =>
  keyOf(identity.stage, identity.assetId ?? null, identity.inputHash);

/**
 * What has to happen next for one project.
 *
 * This is the whole reason the database is the source of truth rather than the
 * queue. Everything here is derived from rows, so a queue that was drained,
 * corrupted or rebuilt from scratch costs one tick of latency and nothing
 * else. Nothing in the system is only recorded in a job.
 *
 * Pure with respect to the queue: it reads and returns payloads. Enqueuing is
 * the caller's business.
 */
export const planProject = async (
  db: Db,
  projectId: string,
): Promise<{ jobs: JobPayload[]; blocked: string[] }> => {
  const jobs: JobPayload[] = [];
  const blocked: string[] = [];

  /**
   * A project that vanished between being listed and being planned is not an
   * error. A deletion request landing mid-sweep is a normal thing to happen,
   * and there is nothing left to plan for it.
   */
  const project = await loadProject(db, projectId).catch(() => null);
  if (project === null) return { jobs, blocked };

  const rows = await loadAssets(db, projectId);
  if (rows.length === 0) return { jobs, blocked };

  const template = getTemplate(project.templateId, project.templateVersion);
  const format = getFormat(template.defaultFormatId);

  const executions = await db
    .select()
    .from(stageExecutions)
    .where(eq(stageExecutions.projectId, projectId));
  const byKey = new Map<string, ExecutionRow>(
    executions.map((e) => [keyOf(e.stage, e.assetId, e.inputHash), e]),
  );

  /**
   * Whether a stage still wants doing, and whether it is beyond help.
   *
   * A stage that has exhausted its attempts, or failed for a reason that will
   * not change, must not be handed out again — otherwise the dispatcher and
   * the runner argue forever and the loop reads like progress.
   */
  const consider = (identity: StageIdentity, label: string): "dispatch" | "done" | "blocked" | "busy" => {
    const row = byKey.get(identityKey(identity));
    if (row === undefined) return "dispatch";
    if (row.status === "succeeded") return "done";
    if (row.status === "running" || row.status === "claimed") return "busy";
    if (row.failureClass === "permanent" || row.attempt >= MAX_ATTEMPTS) {
      blocked.push(`${label}: ${row.error ?? "failed"}`);
      return "blocked";
    }
    return "dispatch";
  };

  const payload = (identity: StageIdentity, extra: { renderId?: string } = {}): JobPayload => ({
    projectId,
    ...(identity.assetId === null || identity.assetId === undefined
      ? {}
      : { assetId: identity.assetId }),
    stage: identity.stage,
    inputHash: identity.inputHash,
    ...extra,
    attempt: 1,
  });

  /* ── 1. ingest, per asset ─────────────────────────────────────────── */
  const ingestHashes = new Map<string, string>();
  let allIngested = true;

  for (const row of rows) {
    const identity = ingestIdentity(row, format);
    ingestHashes.set(row.id, identity.inputHash);
    const verdict = consider(identity, `ingest ${row.slotId ?? row.questionId ?? row.id}`);
    if (verdict === "dispatch") jobs.push(payload(identity));
    if (verdict !== "done") allIngested = false;
  }

  /* ── 2. compose, once every asset is in AND the customer has finished ── */
  // Never while capturing: the set of assets is still changing under it, and
  // a film must only ever be cut from what the customer decided was complete.
  if (allIngested && project.status !== "capturing") {
    const identity = composeIdentity(project, rows, ingestHashes);
    if (consider(identity, "compose") === "dispatch") jobs.push(payload(identity));
  }

  /* ── 3. render, for every cut the customer approved ───────────────── */
  const requested = await db
    .select({
      id: renders.id,
      edlVersionId: renders.edlVersionId,
      formatId: renders.formatId,
      status: renders.status,
      quality: renders.quality,
    })
    .from(renders)
    .innerJoin(edlVersions, eq(renders.edlVersionId, edlVersions.id))
    .where(eq(edlVersions.projectId, projectId))
    .orderBy(desc(renders.createdAt));

  for (const render of requested) {
    if (render.quality !== "delivery") continue;
    const identity = renderIdentity({
      projectId,
      renderId: render.id,
      edlVersionId: render.edlVersionId,
      formatId: render.formatId,
      quality: "delivery",
    });
    const verdict = consider(identity, `render ${render.id.slice(0, 8)}`);
    if (verdict === "dispatch") {
      jobs.push(payload(identity, { renderId: render.id }));
      continue;
    }
    if (verdict !== "done" || project.status === "delivered") continue;

    /* ── 4. deliver, once the film exists and the cut was approved ──── */
    const approved = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.projectId, projectId),
          eq(approvals.edlVersionId, render.edlVersionId),
        ),
      )
      .limit(1);
    if (approved.length === 0) continue;

    const deliver = deliverIdentity({ projectId, renderId: render.id });
    if (consider(deliver, `deliver ${render.id.slice(0, 8)}`) === "dispatch") {
      jobs.push(payload(deliver, { renderId: render.id }));
    }
  }

  return { jobs, blocked };
};

export type DispatchResult = {
  readonly projectsSeen: number;
  readonly jobsEnqueued: number;
  readonly projectsBlocked: number;
};

/**
 * Turn the state of every active project into queue jobs.
 *
 * Runs on a timer rather than being triggered by each stage's completion, and
 * that is the point: a stage that finishes and then fails to enqueue what comes
 * next is invisible to a push-based design and costs one tick here. It is the
 * same code path in the normal case and in the recovery case, so the recovery
 * path is exercised constantly instead of being the branch nobody has run
 * since it was written.
 */
export const dispatchActiveProjects = async (
  db: Db,
  enqueue: (job: JobPayload) => Promise<unknown>,
  options: { readonly limit?: number } = {},
): Promise<DispatchResult> => {
  const active = await db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(inArray(projects.status, [...ACTIVE]))
    .limit(options.limit ?? 200);

  let jobsEnqueued = 0;
  let projectsBlocked = 0;

  for (const { id, status } of active) {
    const { jobs, blocked } = await planProject(db, id);
    for (const job of jobs) {
      await enqueue(job);
      jobsEnqueued += 1;
    }
    if (blocked.length > 0 && jobs.length === 0) {
      /**
       * NEVER mark a capturing project failed. One permanently bad photograph,
       * when it is the only asset so far, is otherwise enough to end a film
       * while the customer is sitting right there able to replace it. A
       * capturing project's dead ends surface as warnings on its hub cards;
       * "failed" is reserved for a film the customer has already handed over.
       */
      if (status === "capturing") continue;
      projectsBlocked += 1;
      /**
       * Marked failed only when nothing else is moving.
       *
       * One permanently bad photograph should not fail a project whose other
       * nine assets are still ingesting — the customer can replace it. It is
       * a dead end only when there is no remaining work at all.
       */
      await db
        .update(projects)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(projects.id, id));
    }
  }

  return { projectsSeen: active.length, jobsEnqueued, projectsBlocked };
};

/**
 * Work that says it is running but is not.
 *
 * A worker that is OOM-killed, hard-crashed or has its container pulled leaves
 * its row in `running` forever, and `running` is exactly what the dispatcher
 * reads as "someone is on it". Nothing else in the system can notice: the job
 * expired out of the queue long ago and the row is the only trace.
 *
 * The threshold is per stage. A render legitimately runs for an hour and an
 * ingest that has been going twenty minutes is already wrong, so one number
 * would either declare healthy renders dead or let dead ingests sit.
 */
export const reconcileStalledStages = async (
  db: Db,
  options: { readonly multiplier?: number; readonly limit?: number } = {},
): Promise<{ swept: number }> => {
  const multiplier = options.multiplier ?? 2;
  const thresholds = new Map<StageName, number>(
    (Object.keys(STAGE_POLICY) as StageName[]).map((stage) => [
      stage,
      STAGE_POLICY[stage].expireInSeconds * 1000 * multiplier,
    ]),
  );
  const shortest = Math.min(...thresholds.values());

  const candidates = await findStalledStages(db, shortest, options.limit ?? 100);
  let swept = 0;

  for (const candidate of candidates) {
    const threshold = thresholds.get(candidate.stage) ?? shortest;
    // Re-read with the stage's own threshold; findStalledStages could only
    // filter by the shortest one.
    const stale = await db
      .select({ id: stageExecutions.id })
      .from(stageExecutions)
      .where(
        and(
          eq(stageExecutions.id, candidate.id),
          eq(stageExecutions.status, "running"),
          lt(stageExecutions.updatedAt, new Date(Date.now() - threshold)),
        ),
      )
      .limit(1);
    if (stale.length === 0) continue;

    /**
     * Transient, and it counts as an attempt.
     *
     * Whatever killed the worker is usually not the work's fault, so it should
     * be retried. But a stage that reliably kills its worker — an OOM on a
     * particular file, say — would otherwise stall, be swept, stall again, for
     * ever. Spending an attempt each time gives that a floor.
     */
    await failStage(db, candidate.id, "transient", "no worker reported back; swept as stalled");
    swept += 1;
  }

  return { swept };
};

/**
 * Projects that have stopped moving for reasons no stage row explains.
 *
 * Distinct from the stall sweep above: this catches a project with no
 * execution rows at all — intake committed, the dispatcher never ran — which
 * would otherwise sit in `processing` indefinitely with nothing to sweep.
 */
export const findIdleProjects = async (
  db: Db,
  olderThanMs: number,
  limit = 50,
): Promise<string[]> => {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .leftJoin(stageExecutions, eq(stageExecutions.projectId, projects.id))
    .where(
      and(
        inArray(projects.status, [...ACTIVE]),
        lt(projects.updatedAt, cutoff),
        or(isNull(stageExecutions.id), eq(stageExecutions.status, "failed")),
      ),
    )
    .limit(limit);
  return [...new Set(rows.map((r) => r.id))];
};
