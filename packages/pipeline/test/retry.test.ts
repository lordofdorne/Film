import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@film/db";
import * as schema from "../../db/src/schema/tables.js";

import { getFormat } from "@film/formats";

import { MAX_ATTEMPTS, planProject } from "../src/dispatch.js";
import { retryProject } from "../src/retry.js";
import { MUSIC_BED_SLOT } from "../src/model.js";
import { loadAssets } from "../src/stages/context.js";
import { ingestIdentity } from "../src/stages/ingest.js";

const FORMAT = getFormat("landscape-classic");

const { assets, projects, stageExecutions, users } = schema;

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";

const projectId = "16161616-1616-4161-8161-161616161616";
const userId = "17171717-1717-4171-8171-171717171717";
const takeId = "18181818-1818-4181-8181-181818181818";
const bedId = "19191919-1919-4191-8191-191919191919";

let pool: pg.Pool;
let db: Db;
let available = false;

beforeAll(async () => {
  try {
    pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
    db = drizzle(pool, { schema });
    await pool.query("select 1");
    available = true;
  } catch (error: unknown) {
    process.stderr.write(`test database unavailable: ${String(error)}\n`);
  }
}, 60_000);

const wipe = async (): Promise<void> => {
  await db.delete(stageExecutions).where(eq(stageExecutions.projectId, projectId));
  await db.delete(assets).where(eq(assets.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));
};

afterAll(async () => {
  if (available) await wipe();
  await pool?.end();
});

beforeEach(async () => {
  if (!available) return;
  await wipe();
  await db.insert(users).values({ id: userId, email: "retry@example.com" });
  await db.insert(projects).values({
    id: projectId,
    ownerId: userId,
    templateId: "life-advice",
    templateVersion: 1,
    subjectData: { subjectName: "Test" },
    config: { questionPrompts: [] },
    status: "failed",
  });
  await db.insert(assets).values([
    {
      id: takeId,
      projectId,
      kind: "interview",
      questionId: "greatest_lesson",
      storageKey: `projects/${projectId}/original/${takeId}/source.mov`,
      byteSize: 1000,
    },
    {
      id: bedId,
      projectId,
      kind: "audio",
      slotId: MUSIC_BED_SLOT,
      storageKey: `projects/${projectId}/original/${bedId}/source.mp3`,
      byteSize: 2000,
    },
  ]);
});

const needsDb = (): void => {
  if (!available) throw new Error("Postgres unavailable — `pnpm db:up`");
};

/**
 * A dead end of the kind that marks a project failed.
 *
 * The hash is the REAL one `ingestIdentity` computes, not a random string —
 * with a random one the dispatcher simply never matches the row and plans a
 * fresh ingest, so the test passes while checking nothing. Caught by an
 * assertion that the film was blocked before the retry.
 */
const deadEnd = async (over: Partial<typeof stageExecutions.$inferInsert> = {}): Promise<void> => {
  const rows = await loadAssets(db, projectId);
  const take = rows.find((r) => r.id === takeId);
  if (take === undefined) throw new Error("no take");

  await db.insert(stageExecutions).values({
    projectId,
    assetId: takeId,
    stage: "ingest",
    inputHash: ingestIdentity(take, FORMAT).inputHash,
    status: "failed",
    attempt: MAX_ATTEMPTS,
    failureClass: "permanent",
    error: "the first failure, which must survive a retry",
    ...over,
  });
};

describe("trying a stuck film again", () => {
  it("moves the project back to where the dispatcher can see it", async () => {
    needsDb();
    await deadEnd();

    // Nothing plans work for a failed project: it is not an ACTIVE status.
    expect(await retryProject(db, projectId)).toEqual({ ok: true, reopened: 1 });

    const after = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(after[0]?.status).toBe("processing");
  });

  /**
   * The half that a status change alone would miss. `consider()` refuses to
   * hand out a stage that failed permanently or used up its attempts, so a
   * button that only flipped the status would spin once and the reconciler
   * would mark the film failed again — a retry that visibly does nothing.
   */
  it("makes the dead ends dispatchable again", async () => {
    needsDb();
    await deadEnd();

    const before = await planProject(db, projectId);
    expect(before.blocked.length).toBeGreaterThan(0);

    await retryProject(db, projectId);

    const after = await planProject(db, projectId);
    expect(after.blocked).toEqual([]);
    expect(after.jobs.map((j) => j.stage)).toContain("ingest");
  });

  it("keeps the first failure's error on the row", async () => {
    needsDb();
    await deadEnd();
    await retryProject(db, projectId);

    const rows = await db
      .select()
      .from(stageExecutions)
      .where(eq(stageExecutions.projectId, projectId));
    // Cleared so it can run; the evidence kept so the second failure is not
    // mistaken for the first.
    expect(rows[0]?.attempt).toBe(0);
    expect(rows[0]?.failureClass).toBeNull();
    expect(rows[0]?.error).toBe("the first failure, which must survive a retry");
  });

  it("refuses a film that is not stuck", async () => {
    needsDb();
    await db.update(projects).set({ status: "rendering" }).where(eq(projects.id, projectId));

    const result = await retryProject(db, projectId);
    expect(result.ok).toBe(false);

    // And it left the film alone rather than throwing work away.
    const after = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(after[0]?.status).toBe("rendering");
  });

  it("refuses a project that is not there", async () => {
    needsDb();
    expect(await retryProject(db, randomUUID())).toEqual({ ok: false, error: "no such project" });
  });

  it("leaves work that already succeeded alone", async () => {
    needsDb();
    await deadEnd();
    await db.insert(stageExecutions).values({
      projectId,
      assetId: bedId,
      stage: "ingest",
      inputHash: "a".repeat(32),
      status: "succeeded",
      attempt: 1,
    });

    await retryProject(db, projectId);

    const done = await db
      .select()
      .from(stageExecutions)
      .where(eq(stageExecutions.assetId, bedId));
    expect(done[0]?.status).toBe("succeeded");
    expect(done[0]?.attempt).toBe(1);
  });
});
