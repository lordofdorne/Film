import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  assertUrlSuitableFor,
  claimStage,
  completeStage,
  failStage,
  findStalledStages,
  hashInputs,
  shouldRetry,
  type Db,
} from "../src/index.js";
import { assets, projects, stageExecutions, users } from "../src/schema/tables.js";
import * as schema from "../src/schema/tables.js";
import { objectKey } from "@film/storage";

/**
 * These run against a REAL Postgres, started on demand via Docker.
 *
 * The behaviour under test — a unique constraint that must treat two NULLs as
 * equal — cannot be verified against a mock or an in-memory shim, because it
 * is a property of Postgres rather than of our code. That is the whole reason
 * the container is worth the seconds it costs.
 */
const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";
const MIGRATION = fileURLToPath(
  new URL("../migrations/0000_initial_pipeline_schema.sql", import.meta.url),
);

let pool: pg.Pool;
let db: Db;
let available = false;

const projectId = "11111111-1111-1111-1111-111111111111";
const assetId = "22222222-2222-2222-2222-222222222222";
const userId = "33333333-3333-3333-3333-333333333333";

beforeAll(async () => {
  try {
    execFileSync("docker", ["inspect", "film-pg"], { stdio: "ignore" });
  } catch {
    try {
      execFileSync(
        "docker",
        ["run", "-d", "--name", "film-pg", "-e", "POSTGRES_PASSWORD=film",
         "-e", "POSTGRES_DB=film", "-p", "55432:5432", "postgres:16-alpine"],
        { stdio: "ignore" },
      );
      for (let i = 0; i < 30; i++) {
        try {
          execFileSync("docker", ["exec", "film-pg", "pg_isready", "-U", "postgres"], { stdio: "ignore" });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", MIGRATION], { stdio: "ignore" });
    } catch {
      return;
    }
  }

  pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
  db = drizzle(pool, { schema });
  await pool.query("select 1");
  available = true;

  await db.delete(stageExecutions);
  await db.delete(assets);
  await db.delete(projects);
  await db.delete(users);
  await db.insert(users).values({ id: userId, email: "test@example.com" });
  await db.insert(projects).values({
    id: projectId,
    ownerId: userId,
    templateId: "life-advice",
    templateVersion: 1,
    subjectData: {},
  });
  await db.insert(assets).values({
    id: assetId,
    projectId,
    kind: "interview",
    questionId: "greatest_lesson",
    storageKey: objectKey({ projectId, kind: "original", assetId, name: "take.mp4" }),
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

const skipIfNoDb = () => {
  if (!available) throw new Error("Postgres unavailable — start it with `docker start film-pg`");
};

describe("connection roles", () => {
  it("lets the web tier use the transaction pooler", () => {
    expect(() =>
      assertUrlSuitableFor("web", "postgres://u:p@db.pooler.supabase.com:6543/postgres"),
    ).not.toThrow();
  });

  it("refuses to give a worker a transaction-pooled URL", () => {
    // pg-boss needs session state and LISTEN/NOTIFY. Through a transaction
    // pooler, jobs are silently never delivered — the worst kind of failure.
    expect(() =>
      assertUrlSuitableFor("worker", "postgres://u:p@db.pooler.supabase.com:6543/postgres"),
    ).toThrow(/transaction-mode pooler/);
  });

  it("refuses a pgbouncer-flagged URL for migrations", () => {
    expect(() =>
      assertUrlSuitableFor("migrations", "postgres://u:p@host:6543/db?pgbouncer=true"),
    ).toThrow(/transaction-mode pooler/);
  });

  it("accepts a direct connection for every role", () => {
    for (const role of ["web", "worker", "migrations"] as const) {
      expect(() => assertUrlSuitableFor(role, "postgres://u:p@host:5432/db")).not.toThrow();
    }
  });

  it("rejects a non-postgres URL", () => {
    expect(() => assertUrlSuitableFor("web", "mysql://u:p@host/db")).toThrow(/postgres/);
  });
});

describe("input hashing", () => {
  it("is stable regardless of key order", () => {
    expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ b: 2, a: 1 }));
  });

  it("changes when the template version changes", () => {
    // Otherwise a template change would silently reuse work cut against the old one.
    expect(hashInputs({ asset: "x", templateVersion: 1 })).not.toBe(
      hashInputs({ asset: "x", templateVersion: 2 }),
    );
  });
});

describe("retry classification", () => {
  it("never retries a permanent failure", () => {
    // Corrupt media is just as corrupt on the fourth attempt.
    expect(shouldRetry("permanent", 1)).toBe(false);
  });

  it("retries a transient failure up to the limit", () => {
    expect(shouldRetry("transient", 1)).toBe(true);
    expect(shouldRetry("transient", 3)).toBe(true);
    expect(shouldRetry("transient", 4)).toBe(false);
  });
});

describe("stage execution against Postgres", () => {
  it("claims a stage exactly once", async () => {
    skipIfNoDb();
    const identity = { projectId, assetId, stage: "ingest" as const, inputHash: hashInputs({ v: 1 }) };

    const first = await claimStage(db, identity);
    expect(first.claimed).toBe(true);

    const second = await claimStage(db, identity);
    expect(second.claimed).toBe(false);
    if (!second.claimed) expect(second.reason).toBe("in_flight");
  });

  it("refuses to redo work that already succeeded", async () => {
    skipIfNoDb();
    const identity = { projectId, assetId, stage: "qc" as const, inputHash: hashInputs({ v: 2 }) };
    const claim = await claimStage(db, identity);
    expect(claim.claimed).toBe(true);
    if (claim.claimed) await completeStage(db, claim.executionId, "out-1");

    const again = await claimStage(db, identity);
    expect(again.claimed).toBe(false);
    if (!again.claimed) expect(again.reason).toBe("already_done");
  });

  it("re-claims a failed stage on the same row, counting the attempt", async () => {
    skipIfNoDb();
    const identity = { projectId, assetId, stage: "transcribe" as const, inputHash: hashInputs({ v: 3 }) };
    const first = await claimStage(db, identity);
    expect(first.claimed).toBe(true);
    if (first.claimed) await failStage(db, first.executionId, "transient", "provider timeout");

    const retry = await claimStage(db, identity);
    expect(retry.claimed).toBe(true);
    // A flaky stage's history stays on one row rather than scattering.
    if (retry.claimed) {
      expect(retry.attempt).toBe(2);
      if (first.claimed) expect(retry.executionId).toBe(first.executionId);
    }
  });

  it("treats a different input hash as different work", async () => {
    skipIfNoDb();
    const a = await claimStage(db, { projectId, assetId, stage: "select", inputHash: hashInputs({ v: 4 }) });
    const b = await claimStage(db, { projectId, assetId, stage: "select", inputHash: hashInputs({ v: 5 }) });
    expect(a.claimed && b.claimed).toBe(true);
  });

  /**
   * The reason the migration uses UNIQUE NULLS NOT DISTINCT.
   *
   * compose, render and deliver are project-wide, so their asset_id is NULL.
   * Postgres treats NULLs as distinct in a unique index by default, which would
   * let compose run twice for the same project and inputs — the exact thing the
   * constraint exists to prevent. Drizzle generated the plain form; this test
   * is what catches it if that patch is ever lost.
   */
  it("deduplicates project-wide stages, where assetId is null", async () => {
    skipIfNoDb();
    const identity = { projectId, assetId: null, stage: "compose" as const, inputHash: hashInputs({ v: 6 }) };

    const first = await claimStage(db, identity);
    expect(first.claimed).toBe(true);

    const second = await claimStage(db, identity);
    expect(second.claimed, "a second compose claimed the same work — NULLS NOT DISTINCT is missing").toBe(false);
  });

  it("finds stages that started and never finished", async () => {
    skipIfNoDb();
    const identity = { projectId, assetId: null, stage: "render" as const, inputHash: hashInputs({ v: 7 }) };
    const claim = await claimStage(db, identity);
    expect(claim.claimed).toBe(true);

    // Backdate it: this is what the reconciler sweeps for.
    await pool.query(
      `update stage_executions set updated_at = now() - interval '1 hour' where stage = 'render'`,
    );
    const stalled = await findStalledStages(db, 60_000);
    expect(stalled.map((s) => s.stage)).toContain("render");
  });
});
