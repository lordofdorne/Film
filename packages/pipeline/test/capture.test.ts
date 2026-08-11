import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@film/db";
import { LocalObjectStore, objectKey } from "@film/storage";
import * as schema from "../../db/src/schema/tables.js";

import {
  attachUpload,
  bedSpecKey,
  clearStep,
  finishCapture,
  loadWalkthrough,
  originalPrefix,
  prepareUpload,
  startCapture,
  type CaptureDeps,
} from "../src/capture.js";
import { MUSIC_BED_SLOT } from "../src/model.js";

const { assets, projects, users } = schema;

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";
const EMAIL = "capture-test@example.com";
const TRACK = "test-bed";

let pool: pg.Pool;
let db: Db;
let deps: CaptureDeps;
let root: string;
let available = false;
let projectId = "";

const SUBJECT = {
  subjectName: "Ada Lovelace",
  displayName: "Ada",
  age: 94,
  relationshipLabel: "grandmother",
  interviewerName: "Asim",
  interviewerRelationship: "grandson",
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "film-capture-"));
  try {
    pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
    db = drizzle(pool, { schema });
    await pool.query("select 1");
    available = true;
  } catch (error: unknown) {
    process.stderr.write(`test database unavailable: ${String(error)}\n`);
    available = false;
  }
  deps = { db, store: new LocalObjectStore(root) };
}, 60_000);

/**
 * The development database is shared with a running worker, so leave nothing:
 * a fixture project left behind gets planned and swept for ever.
 *
 * Projects first. `projects.owner_id` restricts on delete rather than
 * cascading, deliberately — a user row disappearing out from under a customer's
 * films would be worse than a failed delete.
 */
const wipe = async (): Promise<void> => {
  const owner = (await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL)))[0];
  if (owner === undefined) return;
  await db.delete(projects).where(eq(projects.ownerId, owner.id));
  await db.delete(users).where(eq(users.id, owner.id));
};

afterAll(async () => {
  if (available) await wipe();
  await pool?.end();
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  if (!available) return;
  await wipe();
  projectId = await startCapture(deps, { ownerEmail: EMAIL, subject: SUBJECT });
});

const needsDb = (): void => {
  if (!available) throw new Error("Postgres unavailable — `pnpm db:up`");
};

/** Mint, put the bytes, attach the row — what the browser does, in order. */
const capture = async (
  stepId: string,
  contentType: string,
  bytes = new Uint8Array([1, 2, 3, 4]),
): Promise<{ assetId: string; key: string }> => {
  const prepared = await prepareUpload(deps, { projectId, stepId, contentType });
  if (!prepared.ok) throw new Error(prepared.error);
  await deps.store.put(prepared.key, bytes, { contentType });
  const attached = await attachUpload(deps, {
    projectId,
    stepId,
    assetId: prepared.assetId,
    key: prepared.key,
    contentType,
  });
  if (!attached.ok) throw new Error(attached.error);
  return { assetId: prepared.assetId, key: prepared.key };
};

const rowsOf = async (): Promise<(typeof assets.$inferSelect)[]> =>
  db.select().from(assets).where(eq(assets.projectId, projectId));

describe("starting", () => {
  it("creates the project in capturing, which the dispatcher ignores", async () => {
    needsDb();
    const rows = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(rows[0]?.status).toBe("capturing");
  });

  it("resumes from rows rather than remembered state", async () => {
    needsDb();
    await capture("photo_early", "image/jpeg");
    const walkthrough = await loadWalkthrough(deps, projectId);
    const early = walkthrough?.steps.find((s) => s.id === "photo_early");
    expect(early?.asset).not.toBeNull();
    expect(walkthrough?.missing).not.toContain("photo_early");
    expect(walkthrough?.missing).toContain("photo_group");
  });

  it("is not found rather than a server error for a malformed id", async () => {
    needsDb();
    expect(await loadWalkthrough(deps, "not-a-uuid")).toBeNull();
  });
});

describe("what a step will take", () => {
  it("refuses a photo where a spoken answer belongs", async () => {
    needsDb();
    const result = await prepareUpload(deps, {
      projectId,
      stepId: "greatest_lesson",
      contentType: "image/jpeg",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses video where the template asked for a photograph", async () => {
    needsDb();
    const result = await prepareUpload(deps, {
      projectId,
      stepId: "photo_early",
      contentType: "video/mp4",
    });
    expect(result.ok).toBe(false);
  });

  it("takes either for a slot the template says accepts either", async () => {
    needsDb();
    for (const type of ["image/jpeg", "video/mp4"]) {
      const result = await prepareUpload(deps, { projectId, stepId: "keepsake", contentType: type });
      expect(result.ok).toBe(true);
    }
  });

  /** MediaRecorder reports "video/webm;codecs=vp9,opus", not "video/webm". */
  it("ignores the codecs parameter a recorder adds", async () => {
    needsDb();
    const result = await prepareUpload(deps, {
      projectId,
      stepId: "greatest_lesson",
      contentType: "video/webm;codecs=vp9,opus",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a file type nothing downstream can read", async () => {
    needsDb();
    const result = await prepareUpload(deps, {
      projectId,
      stepId: "photo_early",
      contentType: "application/pdf",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses once the film has been handed to the pipeline", async () => {
    needsDb();
    await db.update(projects).set({ status: "processing" }).where(eq(projects.id, projectId));
    const result = await prepareUpload(deps, {
      projectId,
      stepId: "photo_early",
      contentType: "image/jpeg",
    });
    expect(result.ok).toBe(false);
  });
});

describe("the row is written only once the bytes are there", () => {
  it("writes nothing when the upload never arrived", async () => {
    needsDb();
    const prepared = await prepareUpload(deps, {
      projectId,
      stepId: "photo_early",
      contentType: "image/jpeg",
    });
    if (!prepared.ok) throw new Error(prepared.error);

    // No put: the browser died between minting and uploading.
    const attached = await attachUpload(deps, {
      projectId,
      stepId: "photo_early",
      assetId: prepared.assetId,
      key: prepared.key,
      contentType: "image/jpeg",
    });
    expect(attached).toEqual({ ok: false, error: "the upload did not arrive" });
    expect(await rowsOf()).toHaveLength(0);
  });

  it("writes nothing for an empty object", async () => {
    needsDb();
    const prepared = await prepareUpload(deps, {
      projectId,
      stepId: "photo_early",
      contentType: "image/jpeg",
    });
    if (!prepared.ok) throw new Error(prepared.error);
    await deps.store.put(prepared.key, new Uint8Array(0));

    const attached = await attachUpload(deps, {
      projectId,
      stepId: "photo_early",
      assetId: prepared.assetId,
      key: prepared.key,
      contentType: "image/jpeg",
    });
    expect(attached.ok).toBe(false);
    expect(await rowsOf()).toHaveLength(0);
  });

  /**
   * The client hands back the key it was given. A client that hands back a
   * different one is either broken or trying it on, and either way the row must
   * not end up pointing at somebody else's object.
   */
  it("refuses a key that was not minted for this asset", async () => {
    needsDb();
    const prepared = await prepareUpload(deps, {
      projectId,
      stepId: "photo_early",
      contentType: "image/jpeg",
    });
    if (!prepared.ok) throw new Error(prepared.error);

    const elsewhere = objectKey({
      projectId: "99999999-9999-4999-8999-999999999999",
      kind: "original",
      assetId: prepared.assetId,
      name: "source.jpg",
    });
    await deps.store.put(elsewhere, new Uint8Array([1]));

    const attached = await attachUpload(deps, {
      projectId,
      stepId: "photo_early",
      assetId: prepared.assetId,
      key: elsewhere,
      contentType: "image/jpeg",
    });
    expect(attached).toEqual({ ok: false, error: "that key does not belong here" });
    expect(await rowsOf()).toHaveLength(0);
  });

  it("records how the media arrived, and what it is bound to", async () => {
    needsDb();
    await capture("greatest_lesson", "video/mp4");
    const row = (await rowsOf())[0];
    expect(row?.kind).toBe("interview");
    expect(row?.questionId).toBe("greatest_lesson");
    expect(row?.slotId).toBeNull();
    expect(row?.captureMethod).toBe("browser");
    expect(row?.byteSize).toBe(4);
  });

  it("binds a slot capture to its slot, with the kind the file actually is", async () => {
    needsDb();
    await capture("keepsake", "video/mp4");
    const row = (await rowsOf())[0];
    expect(row?.kind).toBe("video");
    expect(row?.slotId).toBe("keepsake");
    expect(row?.questionId).toBeNull();
  });
});

describe("doing it again", () => {
  it("leaves exactly one take, and removes the one it replaced", async () => {
    needsDb();
    const first = await capture("greatest_lesson", "video/mp4", new Uint8Array([1, 2, 3, 4]));
    const second = await capture("greatest_lesson", "video/mp4", new Uint8Array([9, 9]));

    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(second.assetId);
    expect(rows[0]?.byteSize).toBe(2);

    // The object of the replaced take goes only after its row has gone.
    expect(await deps.store.head(first.key)).toBeNull();
    expect(await deps.store.head(second.key)).not.toBeNull();
    expect(await deps.store.list(originalPrefix(projectId, first.assetId))).toEqual([]);
  });

  it("empties a step again when the take is discarded", async () => {
    needsDb();
    const taken = await capture("keepsake", "image/jpeg");
    expect(await clearStep(deps, projectId, "keepsake")).toEqual({ ok: true });
    expect(await rowsOf()).toHaveLength(0);
    expect(await deps.store.head(taken.key)).toBeNull();
  });
});

describe("finishing", () => {
  const everything = async (): Promise<void> => {
    const walkthrough = await loadWalkthrough(deps, projectId);
    if (walkthrough === null) throw new Error("no walkthrough");
    for (const step of walkthrough.steps) {
      if (!step.required) continue;
      await capture(step.id, step.accepts.includes("photo") ? "image/jpeg" : "video/mp4");
    }
  };

  const loadBed = async (): Promise<void> => {
    const sourceKey = `tracks/${TRACK}/source.mp3`;
    await deps.store.put(sourceKey, new Uint8Array([7, 7, 7]), { contentType: "audio/mpeg" });
    await deps.store.put(
      bedSpecKey(TRACK),
      new TextEncoder().encode(
        JSON.stringify({
          trackId: TRACK,
          title: "Test bed",
          cropStartMs: 0,
          cropEndMs: 44_000,
          crossfadeMs: 1_500,
          targetDurationMs: 240_000,
          sourceKey,
        }),
      ),
    );
  };

  it("refuses while anything required is still empty", async () => {
    needsDb();
    await loadBed();
    const result = await finishCapture(deps, projectId, TRACK);
    expect(result.ok).toBe(false);
    const rows = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(rows[0]?.status).toBe("capturing");
  });

  /**
   * A customer never uploads music, so a project with no bed loaded cannot be
   * started — and must say so rather than reaching compose and dying there.
   */
  it("refuses when no bed has been loaded, and leaves the project editable", async () => {
    needsDb();
    await everything();
    const result = await finishCapture(deps, projectId, "no-such-track");
    expect(result.ok).toBe(false);
    const rows = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(rows[0]?.status).toBe("capturing");
  });

  it("attaches a bed of its own and hands the project over", async () => {
    needsDb();
    await everything();
    await loadBed();

    expect(await finishCapture(deps, projectId, TRACK)).toEqual({ ok: true });

    const rows = await db.select().from(projects).where(eq(projects.id, projectId));
    const project = rows[0];
    // The status change IS the handover: the dispatcher's ACTIVE list includes
    // processing and excludes capturing, so nothing else has to happen.
    expect(project?.status).toBe("processing");
    expect((project?.config as { music?: { trackId?: string } }).music?.trackId).toBe(TRACK);

    const bed = (await rowsOf()).find((r) => r.slotId === MUSIC_BED_SLOT);
    expect(bed?.kind).toBe("audio");
    // Its own copy, under its own project prefix — never a shared object, or a
    // deletion request for one project would silently break the others.
    expect(bed?.storageKey.startsWith(`projects/${projectId}/`)).toBe(true);
  });

  it("is idempotent, so a double press does not attach two beds", async () => {
    needsDb();
    await everything();
    await loadBed();
    await finishCapture(deps, projectId, TRACK);
    expect(await finishCapture(deps, projectId, TRACK)).toEqual({ ok: true });
    expect((await rowsOf()).filter((r) => r.slotId === MUSIC_BED_SLOT)).toHaveLength(1);
  });
});
