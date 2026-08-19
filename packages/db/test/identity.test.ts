import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adoptFilms, linkIdentity, ownsProject, type Db } from "../src/index.js";
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

/** Anonymous rows made by these tests, tracked so wipe can find them: an
 *  anonymous user has no email to look up. */
const anonIds: string[] = [];

/** Projects first: owner_id restricts rather than cascading, deliberately. */
const wipe = async (): Promise<void> => {
  const mine = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [EMAIL, OTHER]));
  for (const { id } of [...mine, ...anonIds.map((id) => ({ id }))]) {
    await db.delete(projects).where(eq(projects.ownerId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  anonIds.length = 0;
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

describe("a person who started as nobody", () => {
  const anonymous = async (): Promise<{ authId: string; userId: string }> => {
    const authId = randomUUID();
    const user = await linkIdentity(db, { authId, email: null });
    anonIds.push(user.id);
    return { authId, userId: user.id };
  };

  it("gets a real user row with no address, and owns films with it", async () => {
    needsDb();
    const { authId, userId } = await anonymous();
    const again = await linkIdentity(db, { authId, email: null });
    expect(again.id).toBe(userId);
    expect(again.email).toBeNull();

    const film = await addProject(userId);
    expect(await ownsProject(db, userId, film)).toBe(true);
  });

  /**
   * The plan's dangerous case, in its words: an anonymous user supplies an
   * email later. Our flow does that with a fresh magic-link identity, so the
   * films must follow the person — from the anonymous row to the signed-in one
   * — and only ever from an anonymous row. Draining a real account this way
   * must be impossible no matter what a caller passes.
   */
  it("hands an anonymous browser's films to the identity that clicked the link", async () => {
    needsDb();
    const { authId, userId } = await anonymous();
    const film = await addProject(userId);

    const signedIn = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });
    const moved = await adoptFilms(db, { fromAuthId: authId, toUserId: signedIn.id });

    expect(moved).toBe(1);
    expect(await ownsProject(db, signedIn.id, film)).toBe(true);
    expect(await ownsProject(db, userId, film)).toBe(false);
  });

  it("adopts into an account that already has films without touching them", async () => {
    needsDb();
    const signedIn = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });
    const existing = await addProject(signedIn.id);

    const { authId, userId } = await anonymous();
    const fresh = await addProject(userId);

    await adoptFilms(db, { fromAuthId: authId, toUserId: signedIn.id });
    expect(await ownsProject(db, signedIn.id, existing)).toBe(true);
    expect(await ownsProject(db, signedIn.id, fresh)).toBe(true);
  });

  /**
   * The collision: the "anonymous" identity a caller names turns out to be a
   * real account. Whatever asked for that is confused or malicious, and the
   * only safe answer is to move nothing.
   */
  it("refuses to drain a row that has an address", async () => {
    needsDb();
    const victim = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });
    const film = await addProject(victim.id);

    const thief = await linkIdentity(db, { authId: randomUUID(), email: OTHER });
    const moved = await adoptFilms(db, {
      fromAuthId: victim.authId as string,
      toUserId: thief.id,
    });

    expect(moved).toBe(0);
    expect(await ownsProject(db, victim.id, film)).toBe(true);
    expect(await ownsProject(db, thief.id, film)).toBe(false);
  });

  it("moves nothing for an identity nobody has seen", async () => {
    needsDb();
    const signedIn = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });
    expect(await adoptFilms(db, { fromAuthId: randomUUID(), toUserId: signedIn.id })).toBe(0);
  });

  /**
   * The other way an anonymous person gains an address, and the one that made
   * this a bug: they set a password on the session they already have. Supabase
   * puts an address on that same auth.users row and keeps its id, so no
   * adoption happens or should — but the application row still says email is
   * null, and it is the application row that decides where the film is sent.
   *
   * Matching on authId first is right and stays. Returning the row without
   * looking at the address was the mistake.
   */
  it("learns the address when an anonymous identity gains one", async () => {
    needsDb();
    const { authId, userId } = await anonymous();
    const film = await addProject(userId);

    const now = await linkIdentity(db, { authId, email: EMAIL });

    expect(now.id).toBe(userId);
    expect(now.email).toBe(EMAIL);
    expect(await ownsProject(db, userId, film)).toBe(true);
    // The row learned, rather than a second row appearing beside it.
    expect(await db.select().from(users).where(eq(users.email, EMAIL))).toHaveLength(1);
  });

  it("normalises the address it learns, and settles there", async () => {
    needsDb();
    const { authId, userId } = await anonymous();
    await linkIdentity(db, { authId, email: `  ${EMAIL.toUpperCase()} ` });

    const rows = await db.select().from(users).where(eq(users.id, userId));
    expect(rows[0]?.email).toBe(EMAIL);

    // Every page render calls this; the stored form must match what arrives
    // next time, or it would write on every request for ever.
    const again = await linkIdentity(db, { authId, email: EMAIL.toUpperCase() });
    expect(again.email).toBe(EMAIL);
    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(1);
  });

  /**
   * The collision the plan warned about. Somebody made films anonymously, then
   * set a password using an address that already belongs to an older account
   * of theirs — or of somebody else's. The unique constraint refuses the
   * update, and this must refuse the sign-in rather than carry on with a row
   * that will never learn where to send anything.
   */
  it("refuses when the address it is handed belongs to another row", async () => {
    needsDb();
    const older = await linkIdentity(db, { authId: randomUUID(), email: EMAIL });
    const theirFilm = await addProject(older.id);

    const { authId, userId } = await anonymous();

    await expect(linkIdentity(db, { authId, email: EMAIL })).rejects.toThrow(
      /already belongs to a different account/,
    );

    // Nothing changed hands, and nothing was quietly left half-done.
    expect(await ownsProject(db, older.id, theirFilm)).toBe(true);
    const anon = await db.select().from(users).where(eq(users.id, userId));
    expect(anon[0]?.email).toBeNull();
  });

  /**
   * A request without an address must never erase one. `users.email` decides
   * ownership; a null arriving from anywhere — a token read before a refresh,
   * a provider that omits the claim — must leave a proved address alone.
   */
  it("never forgets an address because a request arrived without one", async () => {
    needsDb();
    const authId = randomUUID();
    const known = await linkIdentity(db, { authId, email: EMAIL });

    const again = await linkIdentity(db, { authId, email: null });

    expect(again.id).toBe(known.id);
    expect(again.email).toBe(EMAIL);
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
