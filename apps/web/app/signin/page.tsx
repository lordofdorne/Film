import { redirect } from "next/navigation";

import { authConfigured, sessionClaims } from "../../src/server/auth.js";
import { safeNext } from "../../src/server/origin.js";
import { AuthShell } from "../AuthShell.js";
import { LinkTrouble } from "./LinkTrouble.js";
import { AccountForm } from "../AccountForm.js";

/** Only a password-reset link can bring anybody here with an error now. */
const MESSAGES: Readonly<Record<string, string>> = {
  link: "That reset link was not one we recognise. Ask for another below.",
  expired:
    "That reset link has expired or was already used. They are good for one use — ask for another below.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; new?: string }>;
}) {
  const { next, error, new: fresh } = await searchParams;

  if (!authConfigured()) {
    return (
      <AuthShell
        title="Sign-in is not configured"
        lede="This server is running without Supabase, so there is nobody to sign in as and every film is open to anyone who has its link. That is the development arrangement, and it is not safe for anything real."
      >
        {null}
      </AuthShell>
    );
  }

  /**
   * Already signed in, meaning to an account.
   *
   * Not `currentUser() !== null`, which is also true of somebody who pressed
   * Start five minutes ago: an anonymous session is a real identity, and
   * bouncing it away from here would mean the one person most likely to want
   * to sign in — someone holding a film and no account — could never reach
   * the form.
   */
  const identity = await sessionClaims();
  if (identity !== null && identity.email !== null) redirect(safeNext(next) ?? "/");

  return (
    <AuthShell
      title="Sign in to your films"
      lede="Your films are kept in your account. Sign in with your email and password to watch and download them."
    >
      {/* Supabase leaves the real reason a reset link failed in the URL
          fragment, which never reaches here — so this is only the fallback. */}
      <LinkTrouble {...(error !== undefined && MESSAGES[error] !== undefined ? { fallback: MESSAGES[error] } : {})} />
      <AccountForm initial={fresh === undefined ? "signin" : "create"} {...(next === undefined ? {} : { next })} />
    </AuthShell>
  );
}

