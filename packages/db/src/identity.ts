import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "./connection.js";
import { isProjectId } from "./ids.js";
import { projects, users } from "./schema/tables.js";

/**
 * Who somebody is, and what they are allowed to see.
 *
 * Supabase Auth issues the session and owns `auth.users`; this owns the mapping
 * from that identity to the application's own user row, and the question every
 * protected surface actually asks — is this project yours.
 *
 * It lives in @film/db rather than in the web app for the usual reason: it is
 * the kind of rule that fails silently and has to be tested against a real
 * database. A route handler cannot be.
 */

/**
 * Postgres unique_violation. The only database error this file interprets
 * rather than re-throwing, because it is the only one that means something
 * about people rather than about the database.
 *
 * Walks the cause chain: Drizzle wraps the driver's error in one of its own,
 * so the code is a level down and a check on the outer error alone quietly
 * never matches.
 */
const isUniqueViolation = (error: unknown): boolean => {
  for (let cause = error, depth = 0; cause !== undefined && cause !== null && depth < 5; depth++) {
    if (typeof cause !== "object") return false;
    if ((cause as { code?: unknown }).code === "23505") return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
};

export type AppUser = {
  readonly id: string;
  /** Null for an anonymous user: a real identity that has not yet proved an
   *  address. */
  readonly email: string | null;
  readonly authId: string | null;
};

/**
 * The application user for a verified identity, linking it on first sign-in.
 *
 * Three cases, and the middle one is the whole reason this function exists:
 *
 *   1. The identity is already linked. Return that row.
 *   2. A row exists for the verified address but has never been signed into —
 *      created by intake, or by somebody typing their email at /start before
 *      they clicked the link in their inbox. Attach the identity to it, and
 *      they keep every film they already made.
 *   3. Nobody has seen this address. Make a row.
 *
 * Without (2), signing in for the first time would silently create a second
 * user and orphan the films made minutes earlier — with no error anywhere, and
 * no way for the customer to describe what went wrong.
 *
 * The email must come from the identity provider's verified claim, never from
 * a form field: an unverified address here would let anyone adopt anybody
 * else's films by typing their address.
 */
export const linkIdentity = async (
  db: Db,
  identity: { readonly authId: string; readonly email: string | null },
): Promise<AppUser> => {
  const email =
    identity.email === null || identity.email.trim() === ""
      ? null
      : identity.email.trim().toLowerCase();

  const linked = await db
    .select()
    .from(users)
    .where(eq(users.authId, identity.authId))
    .limit(1);
  const already = linked[0];
  if (already !== undefined) {
    /**
     * Nothing to learn: the address is the one we already hold, or this
     * request carries none.
     *
     * The null case is a guard, not a formality. `users.email` decides who
     * owns a film, and a null arriving from anywhere — a token read before a
     * refresh, a provider that omits the claim — must leave a proved address
     * exactly where it is. Erasing one would orphan every film on the row.
     */
    if (email === null || email === already.email) {
      return { id: already.id, email: already.email, authId: already.authId };
    }

    /**
     * The identity gained an address. This is not a rare path: it is what
     * happens the moment an anonymous visitor sets a password, because
     * Supabase puts the address on the same auth.users row and keeps its id.
     * No films change hands and none should — they are already owned by this
     * identity. Only the application's record of who they are is out of date.
     *
     * Returning the stale row instead was the original bug, and it was
     * invisible: no error, no wrong page, just a row that said `email is null`
     * for ever and a film with nowhere to be sent.
     */
    try {
      const relearned = await db
        .update(users)
        .set({ email })
        .where(eq(users.id, already.id))
        .returning();
      const now = relearned[0];
      if (now !== undefined) return { id: now.id, email: now.email, authId: now.authId };
    } catch (cause: unknown) {
      // 23505: another row already holds this address. Refuse the sign-in
      // rather than carry on with a row that will never learn it — and never
      // reach across and take the other row, which is the one thing here that
      // could hand somebody else's memories over. `addressTaken` lets the
      // surfaces that cause this refuse before it happens.
      if (!isUniqueViolation(cause)) throw cause;
      throw new Error(`${email} already belongs to a different account`, { cause });
    }
    throw new Error(`could not record the address for ${identity.authId}`);
  }

  /**
   * An anonymous identity: a real row in auth.users with no email. It gets a
   * real row here too, keyed by the identity, so a project can be owned
   * properly from the moment it exists. There is no address to claim an older
   * row with, so the email paths below do not apply.
   */
  if (email === null) {
    const made = await db
      .insert(users)
      .values({ id: identity.authId, email: null, authId: identity.authId })
      .onConflictDoNothing()
      .returning();
    const anon = made[0];
    if (anon !== undefined) return { id: anon.id, email: anon.email, authId: anon.authId };
    // Lost a race with ourselves — two requests from the same fresh session.
    const raced = await db.select().from(users).where(eq(users.authId, identity.authId)).limit(1);
    const row = raced[0];
    if (row !== undefined) return { id: row.id, email: row.email, authId: row.authId };
    throw new Error("could not create a user for an anonymous identity");
  }

  /**
   * Claim the unclaimed row, and only an unclaimed one.
   *
   * The `is null` in the where clause is load-bearing: without it a second
   * identity verifying the same address would take over the first one's films.
   * Supabase will not verify one address for two identities, but this is the
   * last line before somebody else's memories change hands, so it does not
   * depend on that.
   */
  const claimed = await db
    .update(users)
    .set({ authId: identity.authId })
    .where(and(eq(users.email, email), isNull(users.authId)))
    .returning();
  const mine = claimed[0];
  if (mine !== undefined) {
    return { id: mine.id, email: mine.email, authId: mine.authId };
  }

  const created = await db
    .insert(users)
    .values({ id: identity.authId, email, authId: identity.authId })
    .onConflictDoNothing()
    .returning();
  const fresh = created[0];
  if (fresh !== undefined) {
    return { id: fresh.id, email: fresh.email, authId: fresh.authId };
  }

  /**
   * The insert found a row already there. Only two things can have put it
   * there, and they must not be treated the same way.
   *
   * Read back BY IDENTITY, never by address. Reading back by address was the
   * first version of this, and it quietly handed a second identity the first
   * one's films: the update above correctly refused to move the claimed row,
   * the insert correctly did nothing, and then the fallback looked up the
   * address and returned somebody else's account. Caught by the test, not by
   * reading it.
   */
  const settled = await db
    .select()
    .from(users)
    .where(eq(users.authId, identity.authId))
    .limit(1);
  const row = settled[0];
  // Lost a race with a concurrent sign-in as the same person — two tabs, or a
  // double-clicked link. The row is theirs; carry on.
  if (row !== undefined) return { id: row.id, email: row.email, authId: row.authId };

  // A different identity already holds this address. Supabase does not verify
  // one address for two identities, so this should be unreachable — and if it
  // ever happens, refusing the sign-in is the only safe answer.
  throw new Error(`${email} is already linked to a different identity`);
};

/**
 * Does this address already belong to somebody who is not this user?
 *
 * Asked before an address is attached to an identity, so the refusal happens
 * where it can be explained — "that address already has films on it, sign in
 * with the link we email you" — rather than as a unique violation on a later
 * request, when the person is somewhere else entirely and the auth provider
 * has already recorded the address.
 *
 * A check-then-act, so it races in principle. `linkIdentity` still refuses on
 * the constraint, which is the part that has to be right; this only decides
 * whether anyone ever sees that error.
 */
export const addressTaken = async (
  db: Db,
  email: string,
  exceptUserId: string,
): Promise<boolean> => {
  const normalised = email.trim().toLowerCase();
  if (normalised === "") return false;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalised))
    .limit(1);
  const row = rows[0];
  return row !== undefined && row.id !== exceptUserId;
};

/**
 * Move an anonymous browser's films to the person who clicked the link.
 *
 * The one deliberate merge in the system. A browser presses Start, gets an
 * anonymous identity, makes a film — then types an address and clicks the
 * magic link, which signs it in as a different, verified identity. The films
 * must follow the person, and this is the only way they ever change hands.
 *
 * Two guards, both load-bearing:
 *
 *   - The source must be ANONYMOUS — `email is null` in the where clause. The
 *     caller names the source by authId, and a caller that names a real
 *     account, by bug or by malice, must move nothing. This is the collision
 *     the plan called the dangerous one: refuse, never silently hand over.
 *   - The caller must have verified BOTH sides itself: the anonymous session
 *     from the cookie jar it is holding, the signed-in user from the exchange
 *     it just performed. This function trusts its arguments the way every
 *     @film/db function does, and the web callback is the only caller.
 *
 * The emptied anonymous row is left in place rather than deleted: approvals
 * may reference it, and a sweep of childless anonymous rows is retention's
 * job, not sign-in's.
 */
export const adoptFilms = async (
  db: Db,
  move: { readonly fromAuthId: string; readonly toUserId: string },
): Promise<number> => {
  if (!isProjectId(move.fromAuthId) || !isProjectId(move.toUserId)) return 0;

  const source = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.authId, move.fromAuthId), isNull(users.email)))
    .limit(1);
  const anon = source[0];
  if (anon === undefined || anon.id === move.toUserId) return 0;

  const moved = await db
    .update(projects)
    .set({ ownerId: move.toUserId })
    .where(eq(projects.ownerId, anon.id))
    .returning({ id: projects.id });
  return moved.length;
};

/**
 * Whether this user owns this project.
 *
 * A boolean rather than a fetch, because every caller asks the same question
 * and the ones that do not ask are the bug. Answering false for a malformed id
 * keeps a typed URL a 404 rather than a 500 — Postgres raises on the uuid cast.
 */
export const ownsProject = async (
  db: Db,
  userId: string,
  projectId: string,
): Promise<boolean> => {
  if (!isProjectId(projectId) || !isProjectId(userId)) return false;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)))
    .limit(1);
  return rows.length > 0;
};
