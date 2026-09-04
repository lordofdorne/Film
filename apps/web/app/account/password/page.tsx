import Link from "next/link";
import { redirect } from "next/navigation";

import { authConfigured, sessionIdentity } from "../../../src/server/auth.js";
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
      <main className="page page--narrow stack-4">
        <h1 className="title">Accounts are not configured</h1>
        <p className="lede">
          This server runs without Supabase, so there is nobody to have a password.
        </p>
      </main>
    );
  }

  const identity = await sessionIdentity();

  // No session at all, or one that has never proved an address. A password
  // with nothing to sign in as is no use, and Supabase refuses to store one.
  if (identity === null || identity.email === null) {
    redirect("/signin?next=/account/password");
  }

  return (
    <main className="page page--narrow stack-4">
      <h1 className="title">{fromReset ? "Choose a new password" : "Change your password"}</h1>
      <p className="lede">
        {fromReset
          ? "You are signed in. Pick something you will have to hand next time — or close this and carry on; the link in your email works for signing in either way."
          : "You are signed in as "}
        {!fromReset && <strong>{identity.email}</strong>}
        {!fromReset && "."}
      </p>
      <NewPasswordForm />
      <p className="step-nav">
        <Link href="/" className="btn btn--quiet">
          Back to your films
        </Link>
      </p>
    </main>
  );
}

