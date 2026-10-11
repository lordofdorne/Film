"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { chooseNewPassword } from "../../../src/server/passwordActions.js";
import { Button, Notice, TextField } from "../../../src/ui/index.js";

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
      <>
        <Notice tone="success" title="That is set">
          You can sign in with it from now on. Nothing else has changed — your films are where
          you left them.
        </Notice>
        <Button size="lg" block asChild>
          <Link href="/">Your films</Link>
        </Button>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="auth__body" style={{ marginTop: 0 }}>
      <TextField
        id="new-password"
        name="password"
        type="password"
        label="New password"
        required
        minLength={8}
        autoComplete="new-password"
        autoFocus
        hint="At least 8 characters, with a capital letter, a small one and a number."
      />
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Saving…" : "Save this password"}
      </Button>
      {error !== null && <Notice tone="error">{error}</Notice>}
    </form>
  );
};
