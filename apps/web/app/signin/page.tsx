import { redirect } from "next/navigation";

import { authConfigured, sessionIdentity } from "../../src/server/auth.js";
import { safeNext } from "../../src/server/origin.js";
import { SignInForm } from "./SignInForm.js";

const MESSAGES: Readonly<Record<string, string>> = {
  link: "That link was not one we recognise. Ask for another below.",
  expired:
    "That link has expired or was already used. They are good for one sign-in — here is another.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  if (!authConfigured()) {
    return (
      <main style={styles.page}>
        <h1 style={styles.title}>Sign-in is not configured</h1>
        <p style={styles.blurb}>
          This server is running without Supabase, so there is nobody to sign in as and
          every film is open to anyone who has its link. That is the development
          arrangement, and it is not safe for anything real.
        </p>
      </main>
    );
  }

  /**
   * Already signed in, meaning an address has actually been proved.
   *
   * Not `currentUser() !== null`, which is also true of somebody who pressed
   * Start five minutes ago: an anonymous session is a real identity, and
   * bouncing it away from here would mean the one person most likely to want
   * to sign in — someone holding a film and no account — could never reach
   * the form.
   */
  const identity = await sessionIdentity();
  if (identity !== null && identity.email !== null) redirect(safeNext(next) ?? "/");

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Sign in</h1>
      <p style={styles.blurb}>
        Use your password if you set one. If you did not — most people have not — we
        will email you a link instead, and it works just as well.
      </p>
      {error !== undefined && MESSAGES[error] !== undefined && (
        <p style={styles.notice}>{MESSAGES[error]}</p>
      )}
      <SignInForm {...(next === undefined ? {} : { next })} />
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
  notice: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "#5c4a33",
    background: "#fdf6ec",
    border: "1px solid #f0dcc0",
    borderRadius: 8,
    padding: "10px 12px",
    margin: "16px 0 0",
  },
} as const;
