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
      <div className="card note--quiet stack">
        <strong>Almost.</strong> We have sent a note to {confirmTo} to check the address
        is really yours. Click the link in it and your password works from then on —
        until you do, the link is still how you get back in.
      </div>
    );
  }

  if (!open) {
    return (
      <p className="muted">
        <button type="button" onClick={() => { setOpen(true); }} className="linklike">
          {prompt}
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="stack-4">
      <label className="field">
        <span className="field__label">Email address</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={defaultEmail}
          className="input"
        />
      </label>
      <label className="field">
        <span className="field__label">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
        />
        <span className="field__hint">
          At least 8 characters, with a capital letter, a small one and a number.
        </span>
      </label>
      <div className="row">
        <button type="submit" disabled={pending} className="btn btn--primary">
          {pending ? "Setting up…" : "Set a password"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} className="linklike">
          Not now
        </button>
      </div>
      {error !== null && <p className="note note--error">{error}</p>}
    </form>
  );
};

