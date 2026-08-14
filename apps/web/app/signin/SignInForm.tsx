"use client";

import { useState, useTransition } from "react";

import { sendMagicLink } from "../../src/server/authActions.js";

/**
 * No password, because almost nobody signs in here twice in a year.
 *
 * Somebody makes one film, for one person, and comes back months later to
 * watch it again — by which time a password is a thing to reset, not a thing
 * to remember. The link in their inbox is also how they get back to a film
 * they started on a different device.
 */
export const SignInForm = ({ next }: { readonly next?: string }) => {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await sendMagicLink(email, next);
      if (result.ok) setSent(result.email);
      else setError(result.error);
    });
  };

  if (sent !== null) {
    return (
      <div style={styles.done}>
        <h2 style={styles.doneTitle}>Check your email</h2>
        <p style={styles.doneBody}>
          A link is on its way to <strong>{sent}</strong>. Open it on whichever device
          you would like to carry on with — it works on any of them.
        </p>
        <p style={styles.hint}>
          Nothing after a minute or two? Look in spam, or{" "}
          <button type="button" onClick={() => { setSent(null); }} style={styles.again}>
            try a different address
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={styles.form}>
      <label style={styles.field}>
        <span style={styles.label}>Your email address</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          style={styles.input}
        />
      </label>
      <button type="submit" disabled={pending} style={{ ...styles.submit, opacity: pending ? 0.5 : 1 }}>
        {pending ? "Sending…" : "Email me a link"}
      </button>
      {error !== null && <p style={styles.error}>{error}</p>}
    </form>
  );
};

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
  done: { marginTop: 26, padding: 20, border: "1px solid #cfe3d7", background: "#f3f9f5", borderRadius: 10 },
  doneTitle: { fontSize: 18, fontWeight: 600, margin: 0 },
  doneBody: { fontSize: 15, lineHeight: 1.6, color: "#3c5c4a", margin: "10px 0 0" },
  hint: { fontSize: 13, color: "#777", margin: "12px 0 0" },
  again: {
    border: "none",
    background: "none",
    padding: 0,
    font: "inherit",
    color: "#12603a",
    textDecoration: "underline",
    cursor: "pointer",
  },
} as const;
