"use server";

import { redirect } from "next/navigation";

import { addressTaken } from "@film/db";

import { authConfigured, currentUser, dbForAuth, sessionIdentity, supabase } from "./auth.js";
import { origin, safeNext } from "./origin.js";

/**
 * A password, for the people who want one.
 *
 * The magic link stays and stays first: somebody makes one film, for one
 * person, and comes back months later — by which time a password is a thing to
 * reset, not a thing to remember. But a link is useless without a mailbox to
 * hand, and it costs a round trip through an inbox every single time, so this
 * is the second door for anyone who would rather just type something.
 *
 * Three rules hold this together, and each of them is load-bearing:
 *
 *   - Setting a password NEVER creates a second identity. `updateUser` on the
 *     session that is already here keeps its auth id, so the films made
 *     anonymously stay owned by the same person. `signUp()` would make a
 *     second identity and orphan every one of them.
 *   - An address is not ours until somebody proves they can read that mailbox.
 *     Until then it sits in `new_email` and the application's row still says
 *     null — correctly, because that column decides who owns a film.
 *   - Signing in reveals nothing about who has an account here.
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
 * The magic-link path is deliberately explicit about what went wrong, because
 * asking for a link creates the user and there is nothing to leak. This is the
 * opposite case: a password form that says "no account with that address"
 * answers, for anyone who cares to ask, whether a particular person has made a
 * film here. Do not "improve" this into something more helpful.
 */
const NO_MATCH = "That email and password do not match.";

export const signInWithPassword = async (
  rawEmail: string,
  password: string,
  next?: string,
): Promise<PasswordResult> => {
  if (!authConfigured()) {
    return { ok: false, error: "Sign-in is not configured on this server." };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email) || password === "") return { ok: false, error: NO_MATCH };

  const client = await supabase();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null) {
    // Rate limiting is Supabase's (sign_in_sign_ups, per IP). Say so rather
    // than blaming the password, which would send somebody off resetting a
    // password that was right all along.
    if (error.status === 429) {
      return { ok: false, error: "Too many attempts just now. Try again in a few minutes." };
    }
    return { ok: false, error: NO_MATCH };
  }

  redirect(safeNext(next) ?? "/");
};

/* ── setting one ──────────────────────────────────────────────────────── */

export type ClaimResult =
  | { readonly ok: true; readonly confirmTo: string }
  | { readonly ok: false; readonly error: string };

/**
 * Keep this film: an address and a password, on the session already here.
 *
 * Offered after somebody has said where their film should go, and on the
 * finished film. Never a gate — the whole walk-through works with no account
 * at all, and that is the premise of the capture flow, not a detail of it.
 *
 * The address does not take effect here. With confirmations on, Supabase holds
 * it as `new_email` and emails a link; the password is stored immediately but
 * cannot be used until that link is clicked, because until then there is no
 * address to sign in with. The copy at the surface has to say so, or somebody
 * sets a password, signs out, and finds it does not work.
 */
export const claimAccount = async (
  rawEmail: string,
  password: string,
): Promise<ClaimResult> => {
  if (!authConfigured()) {
    return { ok: false, error: "Accounts are not configured on this server." };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "That does not look like an email address." };
  const weak = tooWeak(password);
  if (weak !== null) return { ok: false, error: weak };

  const user = await currentUser();
  if (user === null) {
    return { ok: false, error: "This browser has no session to attach a password to." };
  }
  if (user.email !== null) {
    return { ok: false, error: "You are already signed in — change your password from your account." };
  }

  /**
   * Refuse here rather than at the constraint.
   *
   * If some other row already holds this address, `linkIdentity` will refuse
   * to attach it — correctly, since reaching across and taking that row is the
   * one thing that could hand somebody else's memories over. But by then
   * Supabase would have recorded the address and emailed a confirmation, and
   * the refusal would land on a later request, somewhere else entirely.
   */
  if (await addressTaken(dbForAuth(), email, user.id)) {
    return { ok: false, error: ALREADY_HERE };
  }

  const client = await supabase();
  const { error } = await client.auth.updateUser(
    { email, password },
    { emailRedirectTo: new URL("/auth/callback", await origin()).toString() },
  );

  if (error !== null) {
    /**
     * By code, never by status.
     *
     * Every one of these is a 422, and the first version of this mapped the
     * status rather than the code — so somebody who retyped the same password
     * after a failed attempt was told "that address already has an account
     * here" about an address nobody had ever used, and sent off to a door that
     * would not open. Found by walking the flow, not by reading it.
     */
    if (error.code === "email_exists") {
      /**
       * The address belongs to an identity already — very often one this same
       * person made minutes ago by asking for a magic link, which creates the
       * account the moment it is requested.
       *
       * This does disclose that the address is in use, and there is no way
       * not to: the alternative is to pretend it worked and leave somebody
       * with a password that never signs them in. Point them at the door that
       * does work.
       */
      return { ok: false, error: ALREADY_HERE };
    }
    if (error.code === "same_password") {
      return { ok: false, error: "That is already your password — you are all set." };
    }
    if (error.code === "weak_password") {
      return { ok: false, error: "That password is too easy to guess. Try a longer one." };
    }
    if (error.status === 429) {
      return { ok: false, error: "Too many emails from this server in the last hour. Try again later." };
    }
    /**
     * Only reachable with `secure_password_change` on, which this project
     * deliberately leaves off — it refuses any session older than a day, and
     * the person being offered a password here is somebody who made a film
     * last Tuesday. Handled anyway, because a setting on the hosted dashboard
     * can be turned on by somebody who has not read the config file.
     */
    if (error.code === "reauthentication_needed") {
      return {
        ok: false,
        error: "This browser has been signed in a while. Use the link we emailed you, then set a password.",
      };
    }
    return { ok: false, error: `Could not set that up: ${error.message}` };
  }

  return { ok: true, confirmTo: email };
};

const ALREADY_HERE =
  "That address already has an account here. Sign in with the link we can email you, " +
  "and this film will follow you across.";

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
    // A separate door from the magic link, because every one of these arrives
    // as `?code=` with nothing to say which kind it was.
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
 * Choosing a new one, on a session that has already proved the mailbox.
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

  const identity = await sessionIdentity();
  if (identity === null) {
    return { ok: false, error: "That link has expired. Ask for another from the sign-in page." };
  }
  if (identity.email === null) {
    // An anonymous session cannot hold a password: Supabase refuses one
    // outright when there is no address on the identity, and it is right to.
    return { ok: false, error: "Give us an address first — a password with nothing to sign in as is no use." };
  }

  const client = await supabase();
  const { error } = await client.auth.updateUser({ password });
  if (error !== null) {
    // By code, never by status — the same lesson as claimAccount above.
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
