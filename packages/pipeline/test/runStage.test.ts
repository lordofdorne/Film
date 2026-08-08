import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashInputs, type Db, type StageIdentity } from "@film/db";
// The tables module, not the package index: drizzle's `schema` option expects
// table objects and chokes on the functions the index also exports.
import * as schema from "../../db/src/schema/tables.js";
const { projects, stageEvents, stageExecutions, users } = schema;
import { LocalObjectStore } from "@film/storage";

import { permanent, transient } from "../src/runtime/errors.js";
import { runStage } from "../src/runtime/runStage.js";
import { sweepAbandonedWorkdirs } from "../src/runtime/workdir.js";

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";

const projectId = "88888888-8888-4888-8888-888888888888";
const userId = "99999999-9999-4999-8999-999999999999";

let pool: pg.Pool;
let db: Db;
let store: LocalObjectStore;
let available = false;

const identity = (inputHash = "hash-a"): StageIdentity => ({
  projectId,
  assetId: null,
  stage: "compose",
  inputHash,
});

beforeAll(async () => {
  try {
    pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
    db = drizzle(pool, { schema });
    await pool.query("select 1");
    available = true;
  } catch (error: unknown) {
    process.stderr.write(`test database unavailable: ${String(error)}\n`);
    available = false;
  }
  store = new LocalObjectStore(await mkdtemp(join(tmpdir(), "film-runstage-store-")));
}, 60_000);

/**
 * Tests clean up after themselves.
 *
 * The development database is shared with a running worker, and a fixture
 * project left in `processing` is one the dispatcher will pick up and grind on
 * for ever against storage keys that were never real.
 */
afterAll(async () => {
  if (available) {
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool?.end();
});

beforeEach(async () => {
  if (!available) return;
  // Scoped deletes. An unscoped one here once wiped the development database.
  await db.delete(stageExecutions).where(eq(stageExecutions.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId, email: "runner@example.com" });
  await db.insert(projects).values({
    id: projectId,
    ownerId: userId,
    templateId: "life-advice",
    templateVersion: 1,
    subjectData: {},
    status: "processing",
  });
});

const needsDb = (): void => {
  if (!available) throw new Error("Postgres unavailable — `pnpm db:up`");
};

const rowFor = async (inputHash = "hash-a") => {
  const rows = await db
    .select()
    .from(stageExecutions)
    .where(
      and(eq(stageExecutions.projectId, projectId), eq(stageExecutions.inputHash, inputHash)),
    );
  return rows[0];
};

describe("runStage", () => {
  it("claims, runs and records the output hash", async () => {
    needsDb();
    const outcome = await runStage({ db, store }, identity(), {}, async () => "out-1");

    expect(outcome).toEqual({ status: "succeeded", outputHash: "out-1" });
    const row = await rowFor();
    expect(row?.status).toBe("succeeded");
    expect(row?.outputHash).toBe("out-1");
    expect(row?.attempt).toBe(1);
  });

  /**
   * The guarantee the whole design rests on.
   *
   * Two workers taking the same job must not both render it. Postgres decides
   * the winner on the unique constraint; the loser is told and does nothing.
   */
  it("runs the work exactly once when two workers race the same stage", async () => {
    needsDb();
    let ran = 0;
    const work = async (): Promise<string> => {
      ran += 1;
      await new Promise((r) => setTimeout(r, 50));
      return "out";
    };

    const [a, b] = await Promise.all([
      runStage({ db, store }, identity(), {}, work),
      runStage({ db, store }, identity(), {}, work),
    ]);

    expect(ran).toBe(1);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["skipped", "succeeded"]);
  });

  it("skips a stage that already succeeded rather than repeating it", async () => {
    needsDb();
    await runStage({ db, store }, identity(), {}, async () => "out-1");

    let ran = false;
    const outcome = await runStage({ db, store }, identity(), {}, async () => {
      ran = true;
      return "out-2";
    });

    expect(ran).toBe(false);
    expect(outcome).toEqual({ status: "skipped", reason: "already_done" });
  });

  it("records a permanent failure and does not offer a retry", async () => {
    needsDb();
    const outcome = await runStage({ db, store }, identity(), {}, async () => {
      throw permanent("the take has no audio stream");
    });

    expect(outcome).toMatchObject({
      status: "failed",
      failureClass: "permanent",
      willRetry: false,
    });
    const row = await rowFor();
    expect(row?.status).toBe("failed");
    expect(row?.failureClass).toBe("permanent");
    expect(row?.error).toBe("the take has no audio stream");
  });

  it("counts attempts on the same row when a transient failure is retried", async () => {
    needsDb();
    const first = await runStage({ db, store }, identity(), {}, async () => {
      throw transient("object store timed out");
    });
    expect(first).toMatchObject({ willRetry: true });

    const second = await runStage({ db, store }, identity(), {}, async () => "out");
    expect(second.status).toBe("succeeded");

    const row = await rowFor();
    expect(row?.attempt).toBe(2);
    expect(row?.status).toBe("succeeded");
    // Cleared, so a stale message cannot outlive the failure it described.
    expect(row?.error).toBeNull();
  });

  it("stops retrying once the attempt limit is reached", async () => {
    needsDb();
    const fail = async (): Promise<string> => {
      throw transient("still unavailable");
    };
    for (let i = 0; i < 2; i++) {
      await runStage({ db, store }, identity(), { maxAttempts: 3 }, fail);
    }
    const last = await runStage({ db, store }, identity(), { maxAttempts: 3 }, fail);

    expect(last).toMatchObject({ status: "failed", willRetry: false });
    expect((await rowFor())?.attempt).toBe(3);
  });

  /**
   * An unclassified throw is a bug, not bad input, and bugs are usually
   * environmental until proven otherwise — so it retries, bounded.
   */
  it("treats an unclassified throw as transient", async () => {
    needsDb();
    const outcome = await runStage({ db, store }, identity(), {}, async () => {
      throw new TypeError("cannot read properties of undefined");
    });
    expect(outcome).toMatchObject({ status: "failed", failureClass: "transient", willRetry: true });
  });

  it("times out, aborts the stage's signal and leaves no row running", async () => {
    needsDb();
    let sawAbort = false;
    const outcome = await runStage({ db, store }, identity(), { timeoutMs: 100 }, async (ctx) => {
      await new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => {
          sawAbort = true;
          resolve();
        });
      });
      throw new Error("work observed the abort");
    });

    expect(sawAbort).toBe(true);
    expect(outcome).toMatchObject({ status: "failed", failureClass: "transient" });
    expect((await rowFor())?.status).toBe("failed");
  });

  /**
   * A drain is the operator's doing, not the work's. Classing it as cancelled
   * keeps a rolling deploy from looking like a pipeline of flaky stages.
   */
  it("classes a shutdown as cancelled rather than as a failure of the work", async () => {
    needsDb();
    const parent = new AbortController();
    const outcome = await runStage(
      { db, store },
      identity(),
      { parentSignal: parent.signal },
      async (ctx) => {
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => { resolve(); }, { once: true });
          // Subscribe first, then trigger. An AbortSignal does not replay, so a
          // listener added after the abort never runs.
          setTimeout(() => { parent.abort(); }, 10);
        });
        throw new Error("interrupted");
      },
    );

    expect(outcome).toMatchObject({ status: "failed", failureClass: "cancelled", willRetry: false });
  });

  it("removes the scratch directory whether the stage succeeds or fails", async () => {
    needsDb();
    let succeeded = "";
    let failed = "";

    await runStage({ db, store }, identity("ok"), {}, async (ctx) => {
      succeeded = await ctx.scratch();
      await writeFile(join(succeeded, "mezzanine.mp4"), "x");
      return null;
    });
    await runStage({ db, store }, identity("bad"), {}, async (ctx) => {
      failed = await ctx.scratch();
      await writeFile(join(failed, "mezzanine.mp4"), "x");
      throw permanent("boom");
    });

    expect(succeeded).not.toBe("");
    expect(failed).not.toBe("");
    await expect(readdir(succeeded)).rejects.toThrow();
    await expect(readdir(failed)).rejects.toThrow();
  });

  it("hands back the same scratch directory each time a stage asks", async () => {
    needsDb();
    let a = "";
    let b = "";
    await runStage({ db, store }, identity(), {}, async (ctx) => {
      a = await ctx.scratch();
      b = await ctx.scratch();
      return null;
    });
    expect(a).toBe(b);
  });

  /**
   * Deferring rather than failing matters: there is nothing wrong with the
   * work, this container just has no room. Claiming it would spend one of the
   * stage's retries on a condition that belongs to the machine.
   */
  it("defers without claiming when there is not enough scratch space", async () => {
    needsDb();
    let ran = false;
    const outcome = await runStage(
      { db, store },
      identity(),
      { requiresFreeBytes: Number.MAX_SAFE_INTEGER },
      async () => {
        ran = true;
        return null;
      },
    );

    expect(ran).toBe(false);
    expect(outcome).toEqual({ status: "deferred", reason: "insufficient_disk" });
    expect(await rowFor()).toBeUndefined();
  });

  it("writes the stage's history to stage_events", async () => {
    needsDb();
    await runStage({ db, store }, identity(), {}, async (ctx) => {
      await ctx.log.warn("photo is below the output width");
      return null;
    });

    const row = await rowFor();
    const events = await db
      .select()
      .from(stageEvents)
      .where(eq(stageEvents.stageExecutionId, row?.id ?? ""));

    expect(events.map((e) => e.level)).toEqual(["info", "warn", "info"]);
    expect(events[1]?.message).toBe("photo is below the output width");
  });

  it("distinguishes stages of the same kind by their input hash", async () => {
    needsDb();
    const a = hashInputs({ edlVersion: 1 });
    const b = hashInputs({ edlVersion: 2 });
    expect(a).not.toBe(b);

    expect((await runStage({ db, store }, identity(a), {}, async () => "1")).status).toBe("succeeded");
    expect((await runStage({ db, store }, identity(b), {}, async () => "2")).status).toBe("succeeded");
  });
});

describe("workdir sweep", () => {
  it("leaves recent directories alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "film-sweep-"));
    await writeFile(join(dir, "keep"), "x");
    // Everything under the root is fresh, so nothing of ours should be taken.
    await sweepAbandonedWorkdirs(60 * 60 * 1000);
    await expect(readdir(dir)).resolves.toEqual(["keep"]);
  });
});
