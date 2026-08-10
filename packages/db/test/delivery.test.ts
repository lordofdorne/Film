import { eq } from "drizzle-orm";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveVersion, deliverableFilm, filmFilename, type Db } from "../src/index.js";
import { approvals, edlVersions, projects, renders, users } from "../src/schema/tables.js";
import * as schema from "../src/schema/tables.js";

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";

let pool: pg.Pool;
let db: Db;
let available = false;

const projectId = "44444444-4444-4444-8444-444444444444";
const userId = "33333333-3333-4333-8333-333333333333";
const FORMAT = "landscape-classic";

/** Minimal but schema-valid: nothing here reads inside the document. */
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
  speechSegments: [],
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
}, 60_000);

/** The development database is shared with a running worker; leave nothing. */
afterAll(async () => {
  if (available) {
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool?.end();
});

beforeEach(async () => {
  if (!available) return;
  await db.delete(approvals).where(eq(approvals.projectId, projectId));
  // renders cascade from edl_versions; deleting versions takes them with it.
  await db.delete(edlVersions).where(eq(edlVersions.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId, email: "downloader@example.com" });
  await db.insert(projects).values({
    id: projectId,
    ownerId: userId,
    templateId: "life-advice",
    templateVersion: 1,
    subjectData: { subjectName: "Asim Samuel" },
    status: "awaiting_approval",
  });
});

const needsDb = (): void => {
  if (!available) throw new Error("Postgres unavailable — `pnpm db:up`");
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

/** What the render stage does when it finishes. */
const finishRender = async (renderId: string, key: string): Promise<void> => {
  await db
    .update(renders)
    .set({ status: "succeeded", outputKey: key })
    .where(eq(renders.id, renderId));
};

const approve = async (edlVersionId: string): Promise<string> => {
  const outcome = await approveVersion(db, {
    projectId,
    edlVersionId,
    approvedBy: userId,
    formatId: FORMAT,
  });
  if (!outcome.ok) throw new Error(`approval failed: ${outcome.reason}`);
  return outcome.renderId;
};

describe("deliverableFilm", () => {
  it("offers nothing while the project is still being composed", async () => {
    needsDb();
    await addVersion(1);
    expect(await deliverableFilm(db, projectId)).toBeNull();
  });

  it("offers nothing while the approved cut is still rendering", async () => {
    needsDb();
    const v1 = await addVersion(1);
    await approve(v1);
    // The render row exists and is queued. That is not a film.
    expect(await deliverableFilm(db, projectId)).toBeNull();
  });

  /**
   * The rule this function exists for.
   *
   * A succeeded render with a real file behind it is still not deliverable if
   * nobody approved that cut. Offering it would hand someone a film they never
   * watched, which is the single mistake the approval flow exists to prevent —
   * so the download surface re-establishes it from rows rather than assuming
   * whoever wrote the render row had checked.
   */
  it("refuses a finished render that nobody approved", async () => {
    needsDb();
    const v1 = await addVersion(1);
    const rows = await db
      .insert(renders)
      .values({ edlVersionId: v1, formatId: FORMAT, quality: "delivery", status: "queued" })
      .returning({ id: renders.id });
    await finishRender(rows[0]?.id ?? "", "projects/x/render/delivery.mp4");

    expect(await deliverableFilm(db, projectId)).toBeNull();
  });

  it("offers the film once it is approved and rendered", async () => {
    needsDb();
    const v1 = await addVersion(1);
    const renderId = await approve(v1);
    await finishRender(renderId, "projects/x/render/delivery-landscape-classic-v1.mp4");

    const film = await deliverableFilm(db, projectId);
    expect(film).toMatchObject({
      renderId,
      edlVersionId: v1,
      edlVersion: 1,
      formatId: FORMAT,
      outputKey: "projects/x/render/delivery-landscape-classic-v1.mp4",
    });
  });

  it("offers nothing when the render failed", async () => {
    needsDb();
    const v1 = await addVersion(1);
    const renderId = await approve(v1);
    await db
      .update(renders)
      .set({ status: "failed", error: "loudness verification failed" })
      .where(eq(renders.id, renderId));

    expect(await deliverableFilm(db, projectId)).toBeNull();
  });

  /**
   * A newer cut must not silently retract the film someone already has.
   *
   * Compose can append v2 at any time. Until the customer approves v2 as well,
   * the thing they are owed is still v1, and it stays downloadable.
   */
  it("keeps offering the approved cut after a newer one is composed", async () => {
    needsDb();
    const v1 = await addVersion(1);
    const renderId = await approve(v1);
    await finishRender(renderId, "v1.mp4");
    await addVersion(2);

    expect(await deliverableFilm(db, projectId)).toMatchObject({ edlVersion: 1 });
  });

  it("moves to the newer cut once that one is approved and rendered too", async () => {
    needsDb();
    const v1 = await addVersion(1);
    await finishRender(await approve(v1), "v1.mp4");
    const v2 = await addVersion(2);
    await finishRender(await approve(v2), "v2.mp4");

    expect(await deliverableFilm(db, projectId)).toMatchObject({
      edlVersion: 2,
      outputKey: "v2.mp4",
    });
  });

  it("ignores a preview render, which is watermarked and unapproved", async () => {
    needsDb();
    const v1 = await addVersion(1);
    await approve(v1);
    const rows = await db
      .insert(renders)
      .values({ edlVersionId: v1, formatId: FORMAT, quality: "preview", status: "queued" })
      .returning({ id: renders.id });
    await finishRender(rows[0]?.id ?? "", "preview.mp4");

    expect(await deliverableFilm(db, projectId)).toBeNull();
  });

  it("does not offer another project's film", async () => {
    needsDb();
    const v1 = await addVersion(1);
    await finishRender(await approve(v1), "v1.mp4");

    expect(await deliverableFilm(db, "22222222-2222-4222-8222-222222222222")).toBeNull();
  });
});

describe("filmFilename", () => {
  it("names the file after the person, not after the storage key", () => {
    expect(filmFilename({ subjectName: "Asim Samuel", edlVersion: 1 })).toBe(
      "Asim Samuel — Life Advice (v1).mp4",
    );
  });

  /**
   * This string goes into a Content-Disposition header and onto a filesystem.
   * A quote or a newline in a name would end the quoted string early and let
   * the rest be read as header directives.
   */
  it("drops characters that would break a header or a path", () => {
    const name = filmFilename({
      subjectName: 'Ann "Annie"\r\nO/Brien ',
      edlVersion: 2,
    });
    expect(name).toBe("Ann Annie OBrien — Life Advice (v2).mp4");
    expect(name).not.toMatch(/["\r\n\\/]/);
  });

  it("falls back to a usable name when the subject name is missing", () => {
    expect(filmFilename({ subjectName: "   ", edlVersion: 1 })).toBe("Life Advice (v1).mp4");
  });

  it("keeps accents, which are ordinary in a name", () => {
    expect(filmFilename({ subjectName: "José Ramírez", edlVersion: 1 })).toContain("José Ramírez");
  });

  it("bounds the length so the header cannot be pushed around", () => {
    const long = filmFilename({ subjectName: "a".repeat(500), edlVersion: 1 });
    expect(long.length).toBeLessThan(100);
  });
});
