import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db, StageIdentity } from "@film/db";
import { getFormat } from "@film/formats";
import * as schema from "../../db/src/schema/tables.js";

import {
  dispatchActiveProjects,
  MAX_ATTEMPTS,
  planProject,
  reconcileStalledStages,
} from "../src/dispatch.js";
import { composeIdentity } from "../src/stages/compose.js";
import { deliverIdentity } from "../src/stages/deliver.js";
import { ingestIdentity as ingest } from "../src/stages/ingest.js";
import { renderIdentity } from "../src/stages/render.js";
import { transcribeIdentity } from "../src/stages/transcribe.js";
import { thumbnailIdentity, thumbnailKeyOf } from "../src/stages/thumbnail.js";
import { MUSIC_BED_SLOT, type AssetRow } from "../src/model.js";
import { loadAssets } from "../src/stages/context.js";

const { approvals, assets, edlVersions, projects, renders, stageExecutions, users } = schema;

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";

const projectId = "12121212-1212-4121-8121-121212121212";
const userId = "13131313-1313-4131-8131-131313131313";
const takeId = "14141414-1414-4141-8141-141414141414";
const bedId = "15151515-1515-4151-8151-151515151515";

const FORMAT = getFormat("landscape-classic");

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
    available = false;
  }
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
  // Scoped. An unscoped delete here once wiped the development database.
  await db.delete(stageExecutions).where(eq(stageExecutions.projectId, projectId));
  await db.delete(approvals).where(eq(approvals.projectId, projectId));
  await db.delete(edlVersions).where(eq(edlVersions.projectId, projectId));
  await db.delete(assets).where(eq(assets.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));

  await db.insert(users).values({ id: userId, email: "dispatch@example.com" });
  await db.insert(projects).values({
    id: projectId,
    ownerId: userId,
    templateId: "life-advice",
    templateVersion: 1,
    subjectData: { subjectName: "Test" },
    config: { questionPrompts: [] },
    status: "processing",
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

/** The same read the dispatcher does, so the test cannot disagree about order. */
const rows = async (): Promise<AssetRow[]> => loadAssets(db, projectId);

/** Record a stage as already having reached some state. */
const record = async (
  identity: StageIdentity,
  over: Partial<typeof stageExecutions.$inferInsert> = {},
): Promise<void> => {
  await db.insert(stageExecutions).values({
    projectId: identity.projectId,
    assetId: identity.assetId ?? null,
    stage: identity.stage,
    inputHash: identity.inputHash,
    status: "succeeded",
    ...over,
  });
};

/**
 * Pretend every asset has been ingested, as the stage itself would.
 *
 * Including the thumbnail. Ingest writes one while it has the file open, so a
 * helper that set only `normalisedKey` would model an ingest that never
 * happens and leave every test in this file planning a repair job.
 */
const markIngested = async (): Promise<void> => {
  for (const row of await rows()) {
    await db
      .update(assets)
      .set({
        normalisedKey: `projects/${projectId}/normalised/${row.id}/n`,
        ...(row.kind === "audio" ? {} : { thumbnailKey: thumbnailKeyOf(projectId, row.id) }),
        qcMetrics:
          row.kind === "audio"
            ? { durationMs: 200_000 }
            : { width: 1280, height: 720, durationMs: 9_000 },
      })
      .where(eq(assets.id, row.id));
  }
  for (const row of await rows()) await record(ingest(row, FORMAT));
};

/**
 * Pretend every answer has its words, as the transcribe stage would.
 *
 * Separate from markIngested on purpose: compose now waits for both, and a
 * helper that did the two together would hide the gate this file is here to
 * check.
 */
const markTranscribed = async (): Promise<void> => {
  for (const row of await rows()) {
    if (row.kind !== "interview") continue;
    await db
      .update(assets)
      .set({
        selection: { spoken: "the words that were said in this take" },
        transcriptKey: `projects/${projectId}/transcript/${row.id}/transcript.json`,
      })
      .where(eq(assets.id, row.id));
  }
  for (const row of await rows()) {
    if (row.kind === "interview") await record(transcribeIdentity(row));
  }
};

/** Ingested and transcribed: everything compose waits for. */
const markReady = async (): Promise<void> => {
  await markIngested();
  await markTranscribed();
};

describe("planProject", () => {
  it("plans an ingest for every asset that has not been ingested", async () => {
    needsDb();
    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).toEqual(["ingest", "ingest"]);
    expect(new Set(jobs.map((j) => j.assetId))).toEqual(new Set([takeId, bedId]));
  });

  /**
   * Compose reads every asset's measured size and duration. Dispatching it
   * early would either throw in the stage or, worse, cut the film against
   * dimensions nobody measured.
   */
  it("does not plan compose until every asset is ingested", async () => {
    needsDb();
    const [first] = await rows();
    if (first === undefined) throw new Error("no assets");
    await record(ingest(first, FORMAT));

    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).not.toContain("compose");
    expect(jobs.filter((j) => j.stage === "ingest")).toHaveLength(1);
  });

  it("plans compose once every asset is in and every answer has words", async () => {
    needsDb();
    await markReady();
    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).toEqual(["compose"]);
  });

  /**
   * The gate that Block 8 added. Compose permanently rejects an answer with no
   * words, so dispatching it before transcription is a film that fails for a
   * reason the customer cannot see and cannot fix.
   */
  it("waits for the words before cutting anything", async () => {
    needsDb();
    await markIngested();
    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).toEqual(["transcribe"]);
    expect(jobs[0]?.assetId).toBe(takeId);
  });

  it("plans nothing for a stage that already succeeded", async () => {
    needsDb();
    await markReady();
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
    if (project === undefined) throw new Error("no project");
    const hashes = new Map((await rows()).map((r) => [r.id, ingest(r, FORMAT).inputHash]));
    await record(composeIdentity(project, await rows(), hashes));

    expect((await planProject(db, projectId)).jobs).toEqual([]);
  });

  it("plans nothing for a stage another worker is running", async () => {
    needsDb();
    const [first, second] = await rows();
    if (first === undefined || second === undefined) throw new Error("no assets");
    await record(ingest(first, FORMAT), { status: "running", startedAt: new Date() });

    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.assetId)).toEqual([second.id]);
  });

  /**
   * The dispatcher and the runner have to agree about when to stop. If the
   * runner gives up and the dispatcher keeps handing the work out, the result
   * is a loop that looks like progress and never ends.
   */
  it("stops handing out a stage that failed permanently, and says why", async () => {
    needsDb();
    const [first] = await rows();
    if (first === undefined) throw new Error("no assets");
    await record(ingest(first, FORMAT), {
      status: "failed",
      failureClass: "permanent",
      error: "the take has no audio stream",
    });

    const { jobs, blocked } = await planProject(db, projectId);
    expect(jobs.map((j) => j.assetId)).not.toContain(first.id);
    expect(blocked[0]).toContain("the take has no audio stream");
  });

  it("stops handing out a stage that has used up its attempts", async () => {
    needsDb();
    const [first] = await rows();
    if (first === undefined) throw new Error("no assets");
    await record(ingest(first, FORMAT), {
      status: "failed",
      failureClass: "transient",
      attempt: MAX_ATTEMPTS,
      error: "object store timed out",
    });

    const { jobs, blocked } = await planProject(db, projectId);
    expect(jobs.map((j) => j.assetId)).not.toContain(first.id);
    expect(blocked).toHaveLength(1);
  });

  it("retries a transient failure that has attempts left", async () => {
    needsDb();
    const [first] = await rows();
    if (first === undefined) throw new Error("no assets");
    await record(ingest(first, FORMAT), {
      status: "failed",
      failureClass: "transient",
      attempt: 1,
    });

    const { jobs, blocked } = await planProject(db, projectId);
    expect(jobs.map((j) => j.assetId)).toContain(first.id);
    expect(blocked).toEqual([]);
  });

  it("re-plans ingest when the source object changes underneath it", async () => {
    needsDb();
    await markIngested();
    // A re-upload: same asset row, different bytes, so a different input hash.
    await db.update(assets).set({ byteSize: 9999 }).where(eq(assets.id, takeId));

    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).toEqual(["ingest"]);
    expect(jobs[0]?.assetId).toBe(takeId);
  });
});

/**
 * The stage that exists so a hub can draw a card.
 *
 * The hub used to draw its cards from the customer's originals — 105 MB across
 * one real film, re-fetched on every visit. Ingest now makes a small still
 * while it has the file open, and this stage is what reaches the assets
 * ingested before that existed: their ingest is cached and will never run
 * again, so nothing else can.
 */
describe("planProject — thumbnails", () => {
  /** Ingested, but before ingest knew to make a thumbnail. */
  const forgetThumbnails = async (): Promise<void> => {
    await db.update(assets).set({ thumbnailKey: null }).where(eq(assets.projectId, projectId));
  };

  /**
   * Ingested when an older recipe was current, so the row points at a picture
   * that exists and is no longer the one this code makes.
   */
  const supersedeThumbnails = async (): Promise<void> => {
    await db
      .update(assets)
      .set({ thumbnailKey: `projects/${projectId}/still/${takeId}/thumb-v0.jpg` })
      .where(eq(assets.id, takeId));
  };

  it("plans one for an asset that was ingested before thumbnails existed", async () => {
    needsDb();
    await markReady();
    await forgetThumbnails();

    const { jobs } = await planProject(db, projectId);
    const thumbs = jobs.filter((j) => j.stage === "thumbnail");
    // The take, and not the music bed: sound has no frame in it.
    expect(thumbs.map((j) => j.assetId)).toEqual([takeId]);
  });

  it("plans none once the asset has one", async () => {
    needsDb();
    await markReady();
    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).not.toContain("thumbnail");
  });

  /**
   * The half-wired mechanism. The stage compares keys, so it will replace an
   * older recipe's picture — but the dispatcher used to check only for null, so
   * it never asked, and bumping the recipe would have changed nothing while
   * every row said it had succeeded.
   */
  it("plans a new one when the recipe has moved past the stored picture", async () => {
    needsDb();
    await markReady();
    await supersedeThumbnails();

    const { jobs } = await planProject(db, projectId);
    const thumbs = jobs.filter((j) => j.stage === "thumbnail");
    expect(thumbs.map((j) => j.assetId)).toEqual([takeId]);
  });

  /**
   * The cut must not wait on a picture for a list. A thumbnail that is slow, or
   * broken, or queued behind twenty others, has nothing to say about whether a
   * film can be made.
   */
  it("never holds up the cut", async () => {
    needsDb();
    await markReady();
    await forgetThumbnails();

    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).toContain("compose");
  });

  /**
   * The one that would be embarrassing. A finished film, watched and
   * downloaded, marked FAILED because ffmpeg could not get a frame out of one
   * take for a 56-pixel square.
   */
  it("never fails a project, however permanently it fails itself", async () => {
    needsDb();
    await markReady();
    await forgetThumbnails();

    const take = (await rows()).find((r) => r.id === takeId);
    if (take === undefined) throw new Error("no take");
    await record(thumbnailIdentity(take), {
      status: "failed",
      failureClass: "permanent",
      error: "no decodable frame",
    });

    const { jobs, blocked } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).not.toContain("thumbnail");
    expect(blocked).toEqual([]);

    await dispatchActiveProjects(db, async () => undefined);
    const status = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]?.status;
    expect(status).not.toBe("failed");
  });
});

describe("planProject — render and deliver", () => {
  const seedApprovedCut = async (over: { approve?: boolean } = {}): Promise<{
    renderId: string;
    edlVersionId: string;
  }> => {
    await markReady();
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
    if (project === undefined) throw new Error("no project");
    const hashes = new Map((await rows()).map((r) => [r.id, ingest(r, FORMAT).inputHash]));
    await record(composeIdentity(project, await rows(), hashes));

    const version = (
      await db
        .insert(edlVersions)
        .values({ projectId, version: 1, doc: {}, author: "compose" })
        .returning({ id: edlVersions.id })
    )[0];
    if (version === undefined) throw new Error("no version");

    const render = (
      await db
        .insert(renders)
        .values({
          edlVersionId: version.id,
          formatId: FORMAT.id,
          quality: "delivery",
          status: "queued",
        })
        .returning({ id: renders.id })
    )[0];
    if (render === undefined) throw new Error("no render");

    if (over.approve !== false) {
      await db
        .insert(approvals)
        .values({ projectId, edlVersionId: version.id, approvedBy: userId });
    }
    return { renderId: render.id, edlVersionId: version.id };
  };

  it("plans the render a customer's approval asked for", async () => {
    needsDb();
    const { renderId } = await seedApprovedCut();
    const { jobs } = await planProject(db, projectId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ stage: "render", renderId });
  });

  it("plans deliver once the film exists", async () => {
    needsDb();
    const { renderId, edlVersionId } = await seedApprovedCut();
    await record(
      renderIdentity({
        projectId,
        renderId,
        edlVersionId,
        formatId: FORMAT.id,
        quality: "delivery",
      }),
    );

    const { jobs } = await planProject(db, projectId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ stage: "deliver", renderId });
  });

  /**
   * The one thing this pipeline must never do. A render row can exist without
   * an approval — a superseded request, a manual re-render — and delivering
   * against it would send a customer a film they never watched.
   */
  it("never plans deliver for a cut nobody approved", async () => {
    needsDb();
    const { renderId, edlVersionId } = await seedApprovedCut({ approve: false });
    await record(
      renderIdentity({
        projectId,
        renderId,
        edlVersionId,
        formatId: FORMAT.id,
        quality: "delivery",
      }),
    );

    expect((await planProject(db, projectId)).jobs).toEqual([]);
  });

  it("plans nothing more once the project is delivered", async () => {
    needsDb();
    const { renderId, edlVersionId } = await seedApprovedCut();
    await record(
      renderIdentity({
        projectId,
        renderId,
        edlVersionId,
        formatId: FORMAT.id,
        quality: "delivery",
      }),
    );
    await record(deliverIdentity({ projectId, renderId }));

    expect((await planProject(db, projectId)).jobs).toEqual([]);
  });
});

describe("dispatchActiveProjects", () => {
  it("enqueues what each active project needs", async () => {
    needsDb();
    const sent: string[] = [];
    const result = await dispatchActiveProjects(db, async (job) => {
      if (job.projectId === projectId) sent.push(`${job.stage}:${job.assetId ?? "-"}`);
    });

    expect(result.jobsEnqueued).toBeGreaterThanOrEqual(2);
    expect(sent.sort()).toEqual([`ingest:${bedId}`, `ingest:${takeId}`].sort());
  });

  /**
   * One bad photograph should not fail a project whose other assets are still
   * ingesting — the customer can replace it. It is a dead end only when there
   * is nothing left to do.
   */
  it("fails a project only when nothing at all can still move", async () => {
    needsDb();
    const [first] = await rows();
    if (first === undefined) throw new Error("no assets");
    await record(ingest(first, FORMAT), {
      status: "failed",
      failureClass: "permanent",
      error: "unreadable",
    });

    await dispatchActiveProjects(db, async () => undefined);
    let status = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]?.status;
    expect(status).toBe("processing");

    // Now block the other asset too, so there is nothing left.
    const [, second] = await rows();
    if (second === undefined) throw new Error("no second asset");
    await record(ingest(second, FORMAT), {
      status: "failed",
      failureClass: "permanent",
      error: "unreadable",
    });

    await dispatchActiveProjects(db, async () => undefined);
    status = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]?.status;
    expect(status).toBe("failed");
  });
});

describe("ingest during capture", () => {
  const capturing = async (): Promise<void> => {
    await db.update(projects).set({ status: "capturing" }).where(eq(projects.id, projectId));
  };

  it("ingests a capturing project's takes while the camera is still up", async () => {
    needsDb();
    await capturing();
    const sent: string[] = [];
    await dispatchActiveProjects(db, async (job) => {
      if (job.projectId === projectId) sent.push(job.stage);
    });
    expect(sent).toContain("ingest");
  });

  /** A film is only ever cut from what the customer decided was complete. */
  it("never plans compose while the customer is still capturing", async () => {
    needsDb();
    await capturing();
    await markReady();
    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.stage)).not.toContain("compose");

    // The moment the customer hands it over, the same rows plan a compose.
    await db.update(projects).set({ status: "processing" }).where(eq(projects.id, projectId));
    const after = await planProject(db, projectId);
    expect(after.jobs.map((j) => j.stage)).toContain("compose");
  });

  /**
   * One permanently bad photograph, when it is the only asset so far, must
   * not end a film while the customer is sitting right there able to replace
   * it. The dead end surfaces as a warning on the hub card instead.
   */
  it("never marks a capturing project failed", async () => {
    needsDb();
    await capturing();
    for (const row of await rows()) {
      await record(ingest(row, FORMAT), {
        status: "failed",
        failureClass: "permanent",
        error: "unreadable",
      });
    }
    await dispatchActiveProjects(db, async () => undefined);
    const status = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]?.status;
    expect(status).toBe("capturing");
  });
});

describe("reconcileStalledStages", () => {
  it("leaves work that a worker is plausibly still doing", async () => {
    needsDb();
    const [first] = await rows();
    if (first === undefined) throw new Error("no assets");
    await record(ingest(first, FORMAT), { status: "running", startedAt: new Date() });

    expect(await reconcileStalledStages(db)).toEqual({ swept: 0 });
  });

  /**
   * A worker that is OOM-killed leaves its row `running` for ever, and
   * `running` is exactly what the dispatcher reads as "someone is on it". The
   * job expired out of the queue long ago; this row is the only trace.
   */
  it("sweeps a row whose worker never reported back", async () => {
    needsDb();
    const [first] = await rows();
    if (first === undefined) throw new Error("no assets");
    const identity = ingest(first, FORMAT);
    await record(identity, {
      status: "running",
      startedAt: new Date(0),
      updatedAt: new Date(0),
    });

    expect(await reconcileStalledStages(db)).toEqual({ swept: 1 });

    const swept = (
      await db
        .select()
        .from(stageExecutions)
        .where(eq(stageExecutions.inputHash, identity.inputHash))
    )[0];
    expect(swept?.status).toBe("failed");
    expect(swept?.failureClass).toBe("transient");

    // And the dispatcher picks it straight back up.
    const { jobs } = await planProject(db, projectId);
    expect(jobs.map((j) => j.assetId)).toContain(first.id);
  });

  /**
   * A render legitimately runs for an hour; an ingest twenty minutes in is
   * already wrong. One threshold would either declare healthy renders dead or
   * let dead ingests sit.
   */
  it("gives a render longer to finish than an ingest", async () => {
    needsDb();
    const [first] = await rows();
    if (first === undefined) throw new Error("no assets");
    // 40 minutes ago: past ingest's threshold, well inside a render's.
    const staleness = new Date(Date.now() - 40 * 60 * 1000);
    await record(ingest(first, FORMAT), {
      status: "running",
      startedAt: staleness,
      updatedAt: staleness,
    });
    await record(
      { projectId, assetId: null, stage: "render", inputHash: "render-hash-1" },
      { status: "running", startedAt: staleness, updatedAt: staleness },
    );

    expect(await reconcileStalledStages(db)).toEqual({ swept: 1 });
    const render = (
      await db
        .select()
        .from(stageExecutions)
        .where(eq(stageExecutions.inputHash, "render-hash-1"))
    )[0];
    expect(render?.status).toBe("running");
  });
});
