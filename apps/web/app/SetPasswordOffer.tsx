"use client";

import { useState, useTransition } from "react";

import { claimAccount } from "../src/server/passwordActions.js";

/**
 * "…or set a password now" — an offer, and never a gate.
 *
 * The whole walk-through works with no account at all. That is the premise of
 * the capture flow rather than a detail of it, and this is the component most
 * likely to quietly undo it, so: it starts collapsed, it sits beside the link
 * rather than in front of it, and nothing anywhere waits on it. It appears in
 * exactly two places — after somebody has said where their film should go, and
 * on the finished film, where "keep this" has an obvious meaning.
 *
 * Setting a password does not create a second account. It attaches an address
 * and a password to the session already here, which is why the films made
 * before it stay owned by the same person with nothing to move.
 *
 * The address is not live until it is confirmed, and the copy says so. Without
 * that sentence somebody sets a password, signs out, and finds it does not
 * work — there is no address on the identity to sign in with yet.
 */
export const SetPasswordOffer = ({
  defaultEmail = "",
  prompt = "…or set a password now",
}: {
  readonly defaultEmail?: string;
  readonly prompt?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmTo, setConfirmTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await claimAccount(
        String(form.get("email") ?? ""),
        String(form.get("password") ?? ""),
      );
      if (result.ok) setConfirmTo(result.confirmTo);
      else setError(result.error);
    });
  };

  if (confirmTo !== null) {
    return (
      <div style={styles.done}>
        <strong>Almost.</strong> We have sent a note to {confirmTo} to check the address
        is really yours. Click the link in it and your password works from then on —
        until you do, the link is still how you get back in.
      </div>
    );
  }

  if (!open) {
    return (
      <p style={styles.offerLine}>
        <button type="button" onClick={() => { setOpen(true); }} style={styles.quiet}>
          {prompt}
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={submit} style={styles.form}>
      <label style={styles.field}>
        <span style={styles.label}>Email address</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={defaultEmail}
          style={styles.input}
        />
      </label>
      <label style={styles.field}>
        <span style={styles.label}>Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          style={styles.input}
        />
        <span style={styles.rule}>
          At least 8 characters, with a capital letter, a small one and a number.
        </span>
      </label>
      <div style={styles.row}>
        <button type="submit" disabled={pending} style={{ ...styles.save, opacity: pending ? 0.6 : 1 }}>
          {pending ? "Setting up…" : "Set a password"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} style={styles.quiet}>
          Not now
        </button>
      </div>
      {error !== null && <p style={styles.error}>{error}</p>}
    </form>
  );
};

const styles = {
  offerLine: { margin: "18px 0 0", fontSize: 15 },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
    margin: "18px 0 0",
    padding: 18,
    border: "1px solid #e4e4e4",
    borderRadius: 10,
  },
  field: { display: "flex", flexDirection: "column" as const, gap: 6 },
  label: { fontSize: 14, fontWeight: 600 },
  rule: { fontSize: 12, color: "#888" },
  input: {
    fontSize: 16,
    padding: "10px 12px",
    border: "1px solid #d6d6d6",
    borderRadius: 8,
    fontFamily: "inherit",
  },
  row: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" as const },
  save: {
    background: "#12603a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "11px 22px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#a11", fontSize: 14, margin: 0 },
  done: {
    margin: "18px 0 0",
    padding: 16,
    border: "1px solid #cfe3d7",
    background: "#f3f9f5",
    borderRadius: 10,
    fontSize: 15,
    lineHeight: 1.6,
    color: "#3c5c4a",
  },
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
