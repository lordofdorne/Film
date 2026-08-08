import { eq } from "drizzle-orm";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveVersion, latestEdlVersion, type Db } from "../src/index.js";
import { approvals, edlVersions, projects, users } from "../src/schema/tables.js";
import * as schema from "../src/schema/tables.js";

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";

let pool: pg.Pool;
let db: Db;
let available = false;

const projectId = "55555555-5555-4555-8555-555555555555";
const userId = "66666666-6666-4666-8666-666666666666";

/** Minimal but schema-valid: the approval logic never reads inside the doc. */
const doc = (n: number): unknown => ({
  version: "1.0",
  projectId,
  templateId: "life-advice",
  templateVersion: 1,
  fps: 30,
  totalDurationMs: 1000 * n,
  audio: {
    musicTrackId: "placeholder-tone-bed",
    musicStartMs: 0,
    musicGainDb: -6,
    duckDb: -12,
    beatGridMs: [],
  },
  visualSegments: [
    {
      id: "v1",
      kind: "black",
      startMs: 0,
      durationMs: 1000 * n,
      transitionIn: { type: "cut", durationMs: 0 },
    },
  ],
  promptSegments: [],
  speechSegments: [
    {
      id: "s1",
      questionId: "greatest_lesson",
      assetId: "a1",
      startMs: 0,
      durationMs: 500,
      sourceInMs: 0,
      sourceOutMs: 500,
      captions: [{ text: "hello", startMs: 0, endMs: 400 }],
    },
  ],
});

beforeAll(async () => {
  try {
    pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
    db = drizzle(pool, { schema });
    await pool.query("select 1");
    available = true;
  } catch {
    available = false;
  }
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  if (!available) return;
  await db.delete(approvals).where(eq(approvals.projectId, projectId));
  await db.delete(edlVersions).where(eq(edlVersions.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId, email: "approver@example.com" });
  await db.insert(projects).values({
    id: projectId,
    ownerId: userId,
    templateId: "life-advice",
    templateVersion: 1,
    subjectData: {},
    status: "awaiting_approval",
  });
});

const needsDb = (): void => {
  if (!available) throw new Error("Postgres unavailable — `docker start film-pg`");
};

const addVersion = async (version: number): Promise<string> => {
  const rows = await db
    .insert(edlVersions)
    .values({ projectId, version, doc: doc(version), author: "compose" })
    .returning({ id: edlVersions.id });
  const row = rows[0];
  if (row === undefined) throw new Error("insert returned no row");
  return row.id;
};

describe("approval", () => {
  it("records an approval against the newest cut and advances the project", async () => {
    needsDb();
    const v1 = await addVersion(1);

    const result = await approveVersion(db, {
      projectId,
      edlVersionId: v1,
      approvedBy: userId,
    });
    expect(result.ok).toBe(true);

    const status = await db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(status[0]?.status).toBe("approved");
  });

  /**
   * The guard that matters.
   *
   * A re-compose between page load and button press would otherwise let the
   * customer authorise delivery of a film they never watched.
   */
  it("refuses a cut that has been superseded", async () => {
    needsDb();
    const v1 = await addVersion(1);
    await addVersion(2);

    const result = await approveVersion(db, {
      projectId,
      edlVersionId: v1,
      approvedBy: userId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("superseded");
      expect(result.message).toContain("version 2");
    }

    // And nothing was approved as a side effect.
    const rows = await db.select().from(approvals).where(eq(approvals.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it("approves the newer cut once the customer has seen it", async () => {
    needsDb();
    await addVersion(1);
    const v2 = await addVersion(2);
    const result = await approveVersion(db, {
      projectId,
      edlVersionId: v2,
      approvedBy: userId,
    });
    expect(result.ok).toBe(true);
  });

  it("treats a second approval of the same cut as a double-click, not an error", async () => {
    needsDb();
    const v1 = await addVersion(1);
    expect((await approveVersion(db, { projectId, edlVersionId: v1, approvedBy: userId })).ok).toBe(true);

    const again = await approveVersion(db, { projectId, edlVersionId: v1, approvedBy: userId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("already_approved");

    // Exactly one approval row, so delivery cannot be triggered twice.
    const rows = await db.select().from(approvals).where(eq(approvals.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it("refuses a cut belonging to another project", async () => {
    needsDb();
    await addVersion(1);
    const result = await approveVersion(db, {
      projectId,
      edlVersionId: "77777777-7777-4777-8777-777777777777",
      approvedBy: userId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_version");
  });

  it("reports the newest cut, which is what the preview shows", async () => {
    needsDb();
    await addVersion(1);
    await addVersion(2);
    await addVersion(3);
    expect((await latestEdlVersion(db, projectId))?.version).toBe(3);
  });
});
