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
      <div className="card note--quiet stack">
        <h2 className="heading">That is set</h2>
        <p className="lede">
          You can sign in with it from now on. Nothing else has changed — your films are
          where you left them.
        </p>
        <Link href="/" className="btn btn--primary">
          Back to your films
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stack-4">
      <label className="field">
        <span className="field__label">New password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus
          className="input"
        />
        <span className="field__hint">
          At least 8 characters, with a capital letter, a small one and a number.
        </span>
      </label>
      <button type="submit" disabled={pending} className="btn btn--primary btn--wide">
        {pending ? "Saving…" : "Save this password"}
      </button>
      {error !== null && <p className="note note--error">{error}</p>}
    </form>
  );
};

