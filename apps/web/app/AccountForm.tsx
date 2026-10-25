"use client";

import { useState, useTransition } from "react";

import { createAccount, sendPasswordReset, signInWithPassword } from "../src/server/passwordActions.js";
import { Button, Icon, Notice, TextField } from "../src/ui/index.js";

/**
 * Create an account, or sign in to one: an email and a password, nothing else.
 *
 * One form for both, because the person in front of it often does not know
 * which they need — they made a film last week, or never — and two pages
 * would be two doors to the same room. It sits in two places: the sheet that
 * "Make my film" opens, where creating is the likelier answer, and the sign-in
 * page, where signing in is.
 *
 * With `makeFilm`, getting in also hands that film over, and both land on
 * `next`. Nothing is emailed, except a reset link when somebody asks.
 */
export type AccountMode = "create" | "signin";
type Mode = AccountMode | "forgot";

export const AccountForm = ({
  initial,
  next,
  makeFilm,
  submitLabel,
}: {
  readonly initial: AccountMode;
  readonly next?: string;
  /** A film to make the moment they are in. */
  readonly makeFilm?: string;
  /** What the main button says when creating; "Create account" otherwise. */
  readonly submitLabel?: { readonly create: string; readonly signin: string };
}) => {
  const [mode, setMode] = useState<Mode>(initial);
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [reset, setReset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setError(null);

    startTransition(async () => {
      if (mode === "forgot") {
        const result = await sendPasswordReset(address);
        if (result.ok) setReset(address);
        else setError(result.error);
        return;
      }
      // On success both redirect and never come back.
      const result =
        mode === "create"
          ? await createAccount(address, password, next, makeFilm)
          : await signInWithPassword(address, password, next, makeFilm);
      if (!result.ok) setError(result.error);
    });
  };

  if (reset !== null) {
    return (
      <div className="sent" role="status">
        <span className="sent__icon" aria-hidden>
          <Icon name="mail" size={26} />
        </span>
        <h2 className="heading">Check your email</h2>
        <p className="lede">
          If there is an account for <strong>{reset}</strong>, a link to choose a new password is
          on its way. It is good for one use.
        </p>
        <p className="tiny">Nothing after a minute or two? Look in spam.</p>
      </div>
    );
  }

  const switchTo = (to: Mode) => () => {
    setMode(to);
    setError(null);
  };

  const label =
    mode === "forgot"
      ? "Email me a reset link"
      : mode === "create"
        ? (submitLabel?.create ?? "Create account")
        : (submitLabel?.signin ?? "Sign in");

  return (
    <form onSubmit={go} className="auth__body" style={{ marginTop: 0 }}>
      {mode !== "forgot" && (
        <div className="segmented" role="group" aria-label="New or returning">
          <button type="button" className="segmented__option" aria-pressed={mode === "create"} onClick={switchTo("create")}>
            Create an account
          </button>
          <button type="button" className="segmented__option" aria-pressed={mode === "signin"} onClick={switchTo("signin")}>
            I have one
          </button>
        </div>
      )}

      <TextField
        id="account-email"
        name="email"
        type="email"
        label="Email address"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => { setEmail(event.target.value); }}
      />

      {mode !== "forgot" && (
        <TextField
          // A new id per mode, so a password manager offers to save a new
          // password when creating and fills the saved one when signing in.
          key={mode}
          id={`account-password-${mode}`}
          name="password"
          type="password"
          label="Password"
          required
          {...(mode === "create"
            ? {
                minLength: 8,
                autoComplete: "new-password",
                hint: "At least 8 characters, with a capital letter, a small one and a number.",
              }
            : { autoComplete: "current-password" })}
        />
      )}

      <Button type="submit" size="lg" block pending={pending}>
        {pending ? "One moment…" : label}
      </Button>

      {error !== null && <Notice tone="error">{error}</Notice>}

      <p className="auth__alt">
        {mode === "signin" && (
          <button type="button" className="linklike" onClick={switchTo("forgot")}>
            Forgot your password?
          </button>
        )}
        {mode === "forgot" && (
          <button type="button" className="linklike" onClick={switchTo("signin")}>
            Back to signing in
          </button>
        )}
      </p>
    </form>
  );
};
