import Link from "next/link";
import { redirect } from "next/navigation";

import { authConfigured, sessionClaims } from "../../../src/server/auth.js";
import { AuthShell } from "../../AuthShell.js";
import { NewPasswordForm } from "./NewPasswordForm.js";

/**
 * Choosing a password, for somebody who already has an address here.
 *
 * Two ways in: the reset link, which lands on /auth/recovery and is sent
 * straight here, and anybody signed in who wants to change theirs. The same
 * form serves both — the only difference is the sentence at the top, because
 * arriving from an email and arriving from a menu are different moments.
 */
export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const fromReset = from === "reset";

  if (!authConfigured()) {
    return (
      <AuthShell
        title="Accounts are not configured"
        lede="This server runs without Supabase, so there is nobody to have a password."
      >
        {null}
      </AuthShell>
    );
  }

  const identity = await sessionClaims();

  // No session at all, or one that has never proved an address. A password
  // with nothing to sign in as is no use, and Supabase refuses to store one.
  if (identity === null || identity.email === null) {
    redirect("/signin?next=/account/password");
  }

  return (
    <AuthShell
      title={fromReset ? "Choose a new password" : "Change your password"}
      lede={
        fromReset ? (
          "You are signed in. Pick something you will have to hand next time — or skip it; the link in your email works for signing in either way."
        ) : (
          <>
            For <strong>{identity.email}</strong>.
          </>
        )
      }
    >
      <NewPasswordForm />
      <Link href="/account" className="linklike">
        Back to your account
      </Link>
    </AuthShell>
  );
}
