import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  JobPayloadSchema,
  PGBOSS_SCHEMA,
  QUEUES,
  STAGE_POLICY,
  createQueue,
  enqueueStage,
  ensureQueues,
  type PgBoss,
} from "../src/index.js";

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";

let boss: PgBoss | undefined;
let available = false;

const projectId = "44444444-4444-4444-4444-444444444444";

beforeAll(async () => {
  try {
    boss = createQueue({ connectionString: DB_URL });
    await boss.start();
    await ensureQueues(boss);
    available = true;
  } catch {
    available = false;
  }
}, 120_000);

afterAll(async () => {
  await boss?.stop({ graceful: false });
});

const needsDb = (): void => {
  if (!available) throw new Error("Postgres unavailable — `docker start film-pg`");
};

describe("job payloads", () => {
  it("accepts a project-wide stage with no asset", () => {
    const parsed = JobPayloadSchema.parse({
      projectId,
      stage: "compose",
      inputHash: "abcdef0123456789",
    });
    expect(parsed.assetId).toBeUndefined();
    expect(parsed.attempt).toBe(1);
  });

  it("rejects an unknown stage", () => {
    expect(() =>
      JobPayloadSchema.parse({ projectId, stage: "polish", inputHash: "abcdef0123456789" }),
    ).toThrow();
  });

  it("rejects an unknown key, so a payload cannot carry silent extras", () => {
    expect(() =>
      JobPayloadSchema.parse({
        projectId,
        stage: "ingest",
        inputHash: "abcdef0123456789",
        priority: "high",
      }),
    ).toThrow();
  });
});

describe("stage policy", () => {
  it("covers every queue", () => {
    for (const q of QUEUES) expect(STAGE_POLICY[q]).toBeDefined();
  });

  it("keeps render at concurrency 1 per container", () => {
    // Each render holds a Chrome instance whose memory grows with the film.
    // Two in one container is how you get an OOM kill two thirds of the way in.
    expect(STAGE_POLICY.render.concurrency).toBe(1);
  });

  it("gives render the longest lease and the slowest retry", () => {
    const others = QUEUES.filter((q) => q !== "render").map((q) => STAGE_POLICY[q].expireInSeconds);
    expect(STAGE_POLICY.render.expireInSeconds).toBeGreaterThan(Math.max(...others));
    expect(STAGE_POLICY.render.retryDelaySeconds).toBeGreaterThan(STAGE_POLICY.qc.retryDelaySeconds);
  });
});

describe("pg-boss against Postgres", () => {
  it("owns its tables in its own schema, away from Drizzle's", async () => {
    needsDb();
    // Drizzle manages `public`; pg-boss manages this. Keeping them apart is
    // what stops generated migrations fighting the queue on deploy.
    expect(PGBOSS_SCHEMA).toBe("pgboss");
    // pg-boss also creates its own internal queues (__pgboss__*); assert ours
    // are present rather than that nothing else is.
    const names = (await boss!.getQueues()).map((q) => q.name);
    for (const q of QUEUES) expect(names).toContain(q);
    expect(names.filter((n) => !n.startsWith("__pgboss__")).sort()).toEqual([...QUEUES].sort());
  });

  it("enqueues a job and hands it to a worker", async () => {
    needsDb();
    const inputHash = `h${Date.now().toString(16)}`;
    const received: string[] = [];

    await boss!.work("qc", async ([job]) => {
      if (job !== undefined) received.push((job.data as { inputHash: string }).inputHash);
    });
    await enqueueStage(boss!, { projectId, stage: "qc", inputHash, attempt: 1 });

    for (let i = 0; i < 50 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(received).toContain(inputHash);
  }, 60_000);

  /**
   * The singleton key mirrors the stage_executions unique constraint, so a
   * duplicate enqueue collapses here too. The database is what guarantees
   * correctness; this just avoids queueing work only to discover that.
   */
  it("collapses a duplicate enqueue of identical work", async () => {
    needsDb();
    const payload = {
      projectId,
      stage: "transcribe" as const,
      inputHash: `dup${Date.now().toString(16)}`,
      attempt: 1,
    };
    const first = await enqueueStage(boss!, payload);
    const second = await enqueueStage(boss!, payload);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  }, 60_000);
});
