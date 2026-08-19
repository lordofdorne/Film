"use server";

import { redirect } from "next/navigation";

import { authConfigured, sessionIdentity, supabase } from "./auth.js";
import { origin, safeNext } from "./origin.js";

/**
 * Sign-in, such as it is: type an address, get a link, click it.
 *
 * Deliberately server-side. The one-time-password flow stores a code verifier
 * that the callback route has to present when it exchanges the code, and
 * keeping both halves on the server means the verifier lives in an httpOnly
 * cookie rather than in the page.
 */

export type SendResult =
  | {
      readonly ok: true;
      readonly email: string;
      /** Nothing new was sent: a confirmation for this address is already in
       *  that person's inbox, and a second email would have made a second
       *  account. */
      readonly already: boolean;
    }
  | { readonly ok: false; readonly error: string };

export const sendMagicLink = async (rawEmail: string, next?: string): Promise<SendResult> => {
  if (!authConfigured()) {
    return { ok: false, error: "Sign-in is not configured on this server." };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That does not look like an email address." };
  }

  /**
   * The one place the two ways in could collide, and it is not obvious.
   *
   * Setting a password on an anonymous session leaves the address pending in
   * `new_email` until it is confirmed. Asking for a magic link to that same
   * address does NOT find it — Supabase happily creates a second identity for
   * the address, and the confirmation still sitting in the inbox can then
   * never be honoured, because by the time it is clicked the address belongs
   * to somebody else. The person ends up with a password on an account they
   * can no longer reach.
   *
   * So: while a confirmation is in flight, send nothing and say so. The link
   * they need is already in their inbox.
   */
  const identity = await sessionIdentity();
  if (identity?.pendingEmail === email) return { ok: true, email, already: true };

  const client = await supabase();
  const target = new URL("/auth/callback", await origin());
  const destination = safeNext(next);
  if (destination !== null) target.searchParams.set("next", destination);

  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: target.toString() },
  });

  /**
   * Say what actually went wrong.
   *
   * This used to answer "Could not send the link. Try again in a moment." for
   * every failure, which is the most useless thing it could have said: the real
   * cause was a 429 from the provider's built-in mail service, and "try again
   * in a moment" was advice to do the one thing guaranteed not to work. It cost
   * an evening.
   *
   * Nothing here discloses whether an account exists — a magic link creates the
   * user, so there is nothing to leak. If that ever changes, this must go back
   * to being vague on purpose rather than by accident.
   */
  if (error !== null) {
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return {
        ok: false,
        error:
          "This server has sent too many sign-in emails in the last hour and the " +
          "mail provider is refusing more. Wait, or configure custom SMTP.",
      };
    }
    return { ok: false, error: `Could not send the link: ${error.message}` };
  }
  return { ok: true, email, already: false };
};

export const signOut = async (): Promise<void> => {
  if (authConfigured()) {
    const client = await supabase();
    await client.auth.signOut();
  }
  redirect("/");
};
