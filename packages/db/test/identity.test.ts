import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { linkIdentity, ownsProject, type Db } from "../src/index.js";
import { projects, users } from "../src/schema/tables.js";
import * as schema from "../src/schema/tables.js";

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";

const EMAIL = "identity-test@example.com";
const OTHER = "identity-other@example.com";

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

/** Projects first: owner_id restricts rather than cascading, deliberately. */
const wipe = async (): Promise<void> => {
  const mine = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [EMAIL, OTHER]));
  for (const { id } of mine) {
    await db.delete(projects).where(eq(projects.ownerId, id));
    await db.delete(users).where(eq(users.id, id));
  }
};

afterAll(async () => {
  if (available) await wipe();
  await pool?.end();
});

beforeEach(async () => {
  if (!available) return;
  await wipe();
});

const needsDb = (): void => {
  if (!available) throw new Error("Postgres unavailable — `pnpm db:up`");
};

/** A user row as intake or the capture walk-through leaves it: no identity. */
const unclaimedUser = async (email: string): Promise<string> => {
  const id = randomUUID();
  await db.insert(users).values({ id, email });
  return id;
};

const addProject = async (ownerId: string): Promise<string> => {
  const id = randomUUID();
  await db.insert(projects).values({
    id,
    ownerId,
    templateId: "life-advice",
    templateVersion: 1,
    subjectData: { subjectName: "Ada Lovelace" },
    status: "capturing",
  });
  return id;
};

describe("linkIdentity", () => {
  it("creates a user the first time an unknown address signs in", async () => {
    needsDb();
    const authId = randomUUID();
    const user = await linkIdentity(db, { authId, email: EMAIL });
    expect(user.email).toBe(EMAIL);
    expect(user.authId).toBe(authId);
  });

  it("returns the same user on every later sign-in", async () => {
    needsDb();
    const authId = randomUUID();
    const first = await linkIdentity(db, { authId, email: EMAIL });
    const second = await linkIdentity(db, { authId, email: EMAIL });
    expect(second.id).toBe(first.id);
    const rows = await db.select().from(users).where(eq(users.email, EMAIL));
    expect(rows).toHaveLength(1);
  });

  /**
   * The case the whole function exists for. Somebody types their address at
   * /start, records ten answers, then clicks the link in their inbox. If that
   * made a second user, the films they just made would belong to a stranger —
   * with no error anywhere and nothing they could say to describe it.
   */
  it("adopts the films made before anyone signed in", async () => {
    needsDb();
    const before = await unclaimedUser(EMAIL);
    const film = await addProject(before);

    const user = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });

    expect(user.id).toBe(before);
    expect(await ownsProject(db, user.id, film)).toBe(true);
    expect(await db.select().from(users).where(eq(users.email, EMAIL))).toHaveLength(1);
  });

  it("matches the address regardless of how it was capitalised", async () => {
    needsDb();
    const before = await unclaimedUser(EMAIL);
    const user = await linkIdentity(db, { authId: randomUUID(), email: `  ${EMAIL.toUpperCase()} ` });
    expect(user.id).toBe(before);
  });

  /**
   * A second identity must not be able to take over a row that already has
   * one. Supabase will not verify one address for two identities, but this is
   * the last line before somebody else's memories change hands.
   */
  it("refuses to move a claimed row to a different identity", async () => {
    needsDb();
    const first = randomUUID();
    const mine = await linkIdentity(db, { authId: first, email: EMAIL });
    const film = await addProject(mine.id);

    await expect(
      linkIdentity(db, { authId: randomUUID(), email: EMAIL }),
    ).rejects.toThrow(/already linked to a different identity/);

    expect(await ownsProject(db, mine.id, film)).toBe(true);
    const still = await db.select().from(users).where(eq(users.id, mine.id));
    expect(still[0]?.authId).toBe(first);
  });
});

describe("ownsProject", () => {
  it("is true for the owner and false for anybody else", async () => {
    needsDb();
    const mine = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });
    const theirs = await linkIdentity(db, { authId: randomUUID(), email: OTHER });
    const film = await addProject(mine.id);

    expect(await ownsProject(db, mine.id, film)).toBe(true);
    expect(await ownsProject(db, theirs.id, film)).toBe(false);
  });

  it("is false rather than a crash for ids that cannot be ids", async () => {
    needsDb();
    const mine = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });
    expect(await ownsProject(db, mine.id, "not-a-uuid")).toBe(false);
    expect(await ownsProject(db, "not-a-uuid", randomUUID())).toBe(false);
  });

  it("is false for a project that does not exist", async () => {
    needsDb();
    const mine = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });
    expect(await ownsProject(db, mine.id, randomUUID())).toBe(false);
  });
});
