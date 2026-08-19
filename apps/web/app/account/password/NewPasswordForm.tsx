"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { chooseNewPassword } from "../../../src/server/passwordActions.js";

/**
 * One field, because the second one — "confirm your password" — catches typos
 * a browser's own reveal button catches better, and this form is often reached
 * on a phone by somebody who has just been through an inbox to get here.
 */
export const NewPasswordForm = () => {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await chooseNewPassword(password);
      if (result.ok) setDone(true);
      else setError(result.error);
    });
  };

  if (done) {
    return (
      <div style={styles.done}>
        <h2 style={styles.doneTitle}>That is set</h2>
        <p style={styles.doneBody}>
          You can sign in with it from now on. Nothing else has changed — your films are
          where you left them.
        </p>
        <Link href="/" style={styles.primary}>
          Back to your films
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={styles.form}>
      <label style={styles.field}>
        <span style={styles.label}>New password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus
          style={styles.input}
        />
        <span style={styles.rule}>
          At least 8 characters, with a capital letter, a small one and a number.
        </span>
      </label>
      <button type="submit" disabled={pending} style={{ ...styles.submit, opacity: pending ? 0.5 : 1 }}>
        {pending ? "Saving…" : "Save this password"}
      </button>
      {error !== null && <p style={styles.error}>{error}</p>}
    </form>
  );
};

const styles = {
  form: { display: "flex", flexDirection: "column", gap: 18, marginTop: 26 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 15, fontWeight: 600 },
  rule: { fontSize: 13, color: "#888" },
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
  done: { marginTop: 26, padding: 20, border: "1px solid #cfe3d7", background: "#f3f9f5", borderRadius: 10 },
  doneTitle: { fontSize: 18, fontWeight: 600, margin: 0 },
  doneBody: { fontSize: 15, lineHeight: 1.6, color: "#3c5c4a", margin: "10px 0 0" },
  primary: {
    display: "inline-block",
    marginTop: 16,
    background: "#12603a",
    color: "#fff",
    borderRadius: 8,
    padding: "11px 22px",
    fontSize: 15,
    fontWeight: 600,
    textDecoration: "none",
  },
} as const;
