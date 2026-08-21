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
      <main style={styles.page}>
        <h1 style={styles.title}>Accounts are not configured</h1>
        <p style={styles.blurb}>
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
    <main style={styles.page}>
      <h1 style={styles.title}>{fromReset ? "Choose a new password" : "Change your password"}</h1>
      <p style={styles.blurb}>
        {fromReset
          ? "You are signed in. Pick something you will have to hand next time — or close this and carry on; the link in your email works for signing in either way."
          : "You are signed in as "}
        {!fromReset && <strong>{identity.email}</strong>}
        {!fromReset && "."}
      </p>
      <NewPasswordForm />
      <p style={styles.footer}>
        <Link href="/" style={styles.back}>
          Back to your films
        </Link>
      </p>
    </main>
  );
}

const styles = {
  page: {
    maxWidth: 480,
    margin: "0 auto",
    padding: "64px 24px 96px",
    fontFamily: "system-ui, sans-serif",
    color: "#1a1a1a",
  },
  title: { fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.4 },
  blurb: { fontSize: 16, lineHeight: 1.6, color: "#555", margin: "14px 0 0" },
  footer: { marginTop: 30 },
  back: { color: "#666", textDecoration: "none", fontSize: 15 },
} as const;
