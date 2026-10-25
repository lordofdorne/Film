"use server";

import { redirect } from "next/navigation";

import { addressTaken } from "@film/db";

import {
  anonymousHolder,
  authConfigured,
  carryFilmsOver,
  currentUser,
  dbForAuth,
  linkAccount,
  ownsFilm,
  sessionClaims,
  supabase,
} from "./auth.js";
import { startTheFilmFor } from "./capture.js";
import { origin, safeNext } from "./origin.js";

/**
 * Accounts: an email and a password, and nothing to click in an inbox.
 *
 * Capture needs no account — Start signs the browser in anonymously and the
 * whole walk-through works like that. Making the film does: "Make my film"
 * asks somebody to create an account or sign in, and the finished film is
 * watched and downloaded from that account. Nothing is emailed to anyone
 * except a password reset, when asked for.
 *
 * Three rules hold this together, and each of them is load-bearing:
 *
 *   - Creating an account on the anonymous session NEVER makes a second
 *     identity. `updateUser({ email, password })` keeps the session's auth id,
 *     so the film made anonymously stays owned by the same person. `signUp()`
 *     would make a second identity and orphan it; it is used only when there
 *     is no session at all.
 *   - Email confirmation is off (`supabase/config.toml`, and the hosted
 *     project must match), so the address and password work the moment the
 *     account is made. Owner's decision of 2026-10-24.
 *   - Signing in reveals nothing about who has an account here. Creating one
 *     has to say an address is taken; there is no honest way not to.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PasswordResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Our copy of the rule Supabase is configured with.
 *
 * Duplicated deliberately. GoTrue is the authority and rejects a weak password
 * whatever this says — but it says so as
 * "Password should contain at least one character of each: abcdefg…", which is
 * not a sentence to show somebody who is trying to keep hold of a film about
 * their grandmother. Keep the two in step with `supabase/config.toml`.
 */
const tooWeak = (password: string): string | null => {
  if (password.length < 8) return "Passwords need to be at least 8 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return "Passwords need a capital letter and a small one.";
  }
  if (!/\d/.test(password)) return "Passwords need at least one number.";
  return null;
};

/* ── signing in ───────────────────────────────────────────────────────── */

/**
 * One message for every failure, on purpose.
 *
 * A password form that says "no account with that address"
 * answers, for anyone who cares to ask, whether a particular person has made a
 * film here. Do not "improve" this into something more helpful.
 */
const NO_MATCH = "That email and password do not match.";

/**
 * Where to go once in, and the film to make on the way.
 *
 * `makeFilm` is a claim from the browser like any other: it acts only on a film
 * the now-signed-in account owns, and handing over is idempotent, so pressing
 * twice makes one film. A film that is not ready is simply not handed over;
 * the page they land on says what is still missing.
 */
const arrive = async (
  user: Awaited<ReturnType<typeof linkAccount>>,
  next: string | undefined,
  makeFilm: string | undefined,
): Promise<never> => {
  if (makeFilm !== undefined && (await ownsFilm(user, makeFilm))) await startTheFilmFor(makeFilm);
  redirect(safeNext(next) ?? "/");
};

export const signInWithPassword = async (
  rawEmail: string,
  password: string,
  next?: string,
  makeFilm?: string,
): Promise<PasswordResult> => {
  if (!authConfigured()) {
    return { ok: false, error: "Sign-in is not configured on this server." };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email) || password === "") return { ok: false, error: NO_MATCH };

  const client = await supabase();

  /**
   * Who held this browser BEFORE signing in — very often the anonymous
   * identity that pressed Start and made a film. Read now, because signing in
   * replaces the session, and read from the auth server rather than the
   * cookie, so only a browser that really holds it moves any films.
   */
  const before = await anonymousHolder(client);

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null || data.user === null) {
    // Rate limiting is Supabase's (sign_in_sign_ups, per IP). Say so rather
    // than blaming the password, which would send somebody off resetting a
    // password that was right all along.
    if (error?.status === 429) {
      return { ok: false, error: "Too many attempts just now. Try again in a few minutes." };
    }
    return { ok: false, error: NO_MATCH };
  }

  const user = await linkAccount(data.user.id, data.user.email ?? email);
  await carryFilmsOver(before, user);
  return arrive(user, next, makeFilm);
};

/* ── making one ───────────────────────────────────────────────────────── */

/**
 * A new account: an address and a password.
 *
 * On the session already here when there is one — which, at Make my film,
 * there always is — so the film it made stays theirs with nothing to move.
 * From the sign-in page with no session at all, a plain sign-up.
 */
export const createAccount = async (
  rawEmail: string,
  password: string,
  next?: string,
  makeFilm?: string,
): Promise<PasswordResult> => {
  if (!authConfigured()) {
    return { ok: false, error: "Accounts are not configured on this server." };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "That does not look like an email address." };
  const weak = tooWeak(password);
  if (weak !== null) return { ok: false, error: weak };

  const claims = await sessionClaims();
  if (claims?.email !== null && claims?.email !== undefined) {
    return { ok: false, error: "You are already signed in." };
  }

  const client = await supabase();
  const holder = claims === null ? null : await currentUser();

  if (holder === null || claims === null) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error !== null || data.user === null || data.session === null) {
      return { ok: false, error: refusal(error) };
    }
    return arrive(await linkAccount(data.user.id, email), next, makeFilm);
  }

  /**
   * Refuse here rather than at the constraint.
   *
   * If some other row already holds this address, `linkIdentity` will refuse
   * to attach it — correctly, since reaching across and taking that row is the
   * one thing that could hand somebody else's memories over. Asking first
   * means Supabase never records an address that is not going to stick.
   */
  if (await addressTaken(dbForAuth(), email, holder.id)) {
    return { ok: false, error: ALREADY_HERE };
  }

  const { error } = await client.auth.updateUser({ email, password });
  if (error !== null) return { ok: false, error: refusal(error) };

  /**
   * The token still says "anonymous, no address" until it is refreshed, and
   * every page reads who somebody is from the token. Refresh now, so the page
   * this redirects to already knows them.
   */
  await client.auth.refreshSession();
  return arrive(await linkAccount(claims.authId, email), next, makeFilm);
};

/**
 * By code, never by status.
 *
 * Every one of these is a 422, and the first version of this mapped the status
 * rather than the code — so somebody who retyped the same password after a
 * failed attempt was told "that address already has an account here" about an
 * address nobody had ever used. Found by walking the flow, not by reading it.
 */
const refusal = (error: { code?: string | undefined; status?: number | undefined; message: string } | null): string => {
  if (error === null) return "Could not make that account. Try again in a moment.";
  if (error.code === "email_exists" || error.code === "user_already_exists") return ALREADY_HERE;
  if (error.code === "weak_password") return "That password is too easy to guess. Try a longer one.";
  if (error.status === 429) return "Too many attempts just now. Try again in a few minutes.";
  return `Could not make that account: ${error.message}`;
};

const ALREADY_HERE = "That address already has an account. Sign in instead, and this film comes with you.";

/* ── forgetting one ───────────────────────────────────────────────────── */

/**
 * Always the same answer, whether or not there is an account.
 *
 * A reset form that says "no account with that address" is an account
 * enumerator with a friendly face.
 */
export const sendPasswordReset = async (rawEmail: string): Promise<PasswordResult> => {
  if (!authConfigured()) {
    return { ok: false, error: "Sign-in is not configured on this server." };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "That does not look like an email address." };

  const client = await supabase();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    // Lands on the route that signs them in and opens the new-password form.
    redirectTo: new URL("/auth/recovery", await origin()).toString(),
  });

  if (error !== null && error.status === 429) {
    return {
      ok: false,
      error:
        "This server has sent too many emails in the last hour and the mail provider " +
        "is refusing more. Wait, or configure custom SMTP.",
    };
  }
  // Any other failure is reported as success on purpose: see above.
  return { ok: true };
};

/**
 * Choosing a new one, signed in or from a reset link.
 *
 * Reached from the recovery link, and usable by anyone signed in who wants to
 * change theirs. Supabase is configured with `secure_password_change`, so a
 * session that has been sitting around for days is asked to prove itself again
 * rather than being quietly allowed to change the password.
 */
export const chooseNewPassword = async (password: string): Promise<PasswordResult> => {
  if (!authConfigured()) {
    return { ok: false, error: "Sign-in is not configured on this server." };
  }

  const weak = tooWeak(password);
  if (weak !== null) return { ok: false, error: weak };

  const identity = await sessionClaims();
  if (identity === null) {
    return { ok: false, error: "That link has expired. Ask for another from the sign-in page." };
  }
  if (identity.email === null) {
    // An anonymous session cannot hold a password: Supabase refuses one
    // outright when there is no address on the identity, and it is right to.
    return { ok: false, error: "Create an account first — a password with nothing to sign in as is no use." };
  }

  const client = await supabase();
  const { error } = await client.auth.updateUser({ password });
  if (error !== null) {
    // By code, never by status — the same lesson as `refusal` above.
    if (error.code === "same_password") {
      return { ok: false, error: "That is the password you already have. Pick a different one." };
    }
    if (error.code === "weak_password") {
      return { ok: false, error: "That password is too easy to guess. Try a longer one." };
    }
    if (error.code === "reauthentication_needed" || error.status === 401) {
      return {
        ok: false,
        error: "For a change this important we need a fresh sign-in. Ask for a reset link and use that.",
      };
    }
    return { ok: false, error: `Could not change it: ${error.message}` };
  }
  return { ok: true };
};
