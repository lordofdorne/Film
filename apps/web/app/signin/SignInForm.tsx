"use client";

import { useState, useTransition } from "react";

import { sendMagicLink } from "../../src/server/authActions.js";
import { sendPasswordReset, signInWithPassword } from "../../src/server/passwordActions.js";

/**
 * One page, two ways in, and no second door.
 *
 * A separate /login and /signup would be two doors to the same room, and this
 * product has a third state besides — most people arrive holding a film they
 * made without an account at all. So: one address field, a password if they
 * set one, and the link for everybody else. Whichever they use, they land in
 * the same place and their films come with them.
 *
 * The password is offered first because somebody who has one is here to type
 * it. The link is not hidden: it is the path that always works.
 */
type Mode = "password" | "link" | "forgot";

export const SignInForm = ({ next }: { readonly next?: string }) => {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<{ email: string; already: boolean } | null>(null);
  const [reset, setReset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setError(null);

    startTransition(async () => {
      if (mode === "password") {
        // On success this redirects and never comes back.
        const result = await signInWithPassword(address, password, next);
        if (!result.ok) setError(result.error);
        return;
      }
      if (mode === "forgot") {
        const result = await sendPasswordReset(address);
        if (result.ok) setReset(address);
        else setError(result.error);
        return;
      }
      const result = await sendMagicLink(address, next);
      if (result.ok) setSent({ email: result.email, already: result.already });
      else setError(result.error);
    });
  };

  if (reset !== null) {
    return (
      <Done title="Check your email">
        If there is an account for <strong>{reset}</strong>, a link to choose a new
        password is on its way. It is good for one use.
      </Done>
    );
  }

  if (sent !== null) {
    return (
      <Done title="Check your email">
        {sent.already ? (
          <>
            There is already a link waiting in <strong>{sent.email}</strong> — the one we
            sent when you set a password. Open that one; a second would make a second
            account and leave your film behind.
          </>
        ) : (
          <>
            A link is on its way to <strong>{sent.email}</strong>. Open it on whichever
            device you would like to carry on with — it works on any of them.
          </>
        )}
      </Done>
    );
  }

  return (
    <form onSubmit={go} style={styles.form}>
      <label style={styles.field}>
        <span style={styles.label}>Your email address</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => { setEmail(event.target.value); }}
          style={styles.input}
        />
      </label>

      {mode === "password" && (
        <label style={styles.field}>
          <span style={styles.label}>Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            style={styles.input}
          />
        </label>
      )}

      <button type="submit" disabled={pending} style={{ ...styles.submit, opacity: pending ? 0.5 : 1 }}>
        {pending
          ? "One moment…"
          : mode === "password"
            ? "Sign in"
            : mode === "forgot"
              ? "Email me a reset link"
              : "Email me a link"}
      </button>

      {error !== null && <p style={styles.error}>{error}</p>}

      <p style={styles.alternatives}>
        {mode === "password" ? (
          <>
            <Quiet onClick={() => { setMode("link"); setError(null); }}>
              Email me a link instead
            </Quiet>
            {" · "}
            <Quiet onClick={() => { setMode("forgot"); setError(null); }}>
              Forgot your password?
            </Quiet>
          </>
        ) : (
          <Quiet onClick={() => { setMode("password"); setError(null); }}>
            Use a password instead
          </Quiet>
        )}
      </p>

      {mode === "link" && (
        <p style={styles.hint}>
          No password needed. The link signs you in on whichever device you open it on.
        </p>
      )}
    </form>
  );
};

const Done = ({ title, children }: { readonly title: string; readonly children: React.ReactNode }) => (
  <div style={styles.done}>
    <h2 style={styles.doneTitle}>{title}</h2>
    <p style={styles.doneBody}>{children}</p>
    <p style={styles.hint}>Nothing after a minute or two? Look in spam.</p>
  </div>
);

const Quiet = ({ onClick, children }: { readonly onClick: () => void; readonly children: React.ReactNode }) => (
  <button type="button" onClick={onClick} style={styles.quiet}>
    {children}
  </button>
);

const styles = {
  form: { display: "flex", flexDirection: "column", gap: 18, marginTop: 26 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 15, fontWeight: 600 },
  input: {
    fontSize: 16,
    padding: "10px 12px",
    border: "1px solid #d6d6d6",
    borderRadius: 8,
    fontFamily: "inherit",
  },
  submit: {
    background: "#12603a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "13px 22px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#a11", fontSize: 14, margin: 0 },
  alternatives: { fontSize: 14, color: "#888", margin: 0 },
  hint: { fontSize: 13, color: "#777", margin: "12px 0 0" },
  done: { marginTop: 26, padding: 20, border: "1px solid #cfe3d7", background: "#f3f9f5", borderRadius: 10 },
  doneTitle: { fontSize: 18, fontWeight: 600, margin: 0 },
  doneBody: { fontSize: 15, lineHeight: 1.6, color: "#3c5c4a", margin: "10px 0 0" },
  quiet: {
    border: "none",
    background: "none",
    padding: 0,
    font: "inherit",
    color: "#12603a",
    textDecoration: "underline",
    cursor: "pointer",
  },
} as const;
