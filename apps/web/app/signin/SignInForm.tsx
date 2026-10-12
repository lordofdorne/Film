"use client";

import { useState, useTransition } from "react";

import { sendMagicLink } from "../../src/server/authActions.js";
import { sendPasswordReset, signInWithPassword } from "../../src/server/passwordActions.js";
import { Button, Icon, Notice, TextField } from "../../src/ui/index.js";

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
      <Sent title="Check your email">
        If there is an account for <strong>{reset}</strong>, a link to choose a new password
        is on its way. It is good for one use.
      </Sent>
    );
  }

  if (sent !== null) {
    return (
      <Sent title="Check your email">
        {sent.already ? (
          <>
            There is already a link waiting in <strong>{sent.email}</strong> — the one we
            sent when you set a password. Open that one; a second would make a second account
            and leave your film behind.
          </>
        ) : (
          <>
            A link is on its way to <strong>{sent.email}</strong>. Open it in this browser to
            sign in.
          </>
        )}
      </Sent>
    );
  }

  const switchTo = (to: Mode) => () => {
    setMode(to);
    setError(null);
  };

  return (
    <form onSubmit={go} className="auth__body" style={{ marginTop: 0 }}>
      {mode !== "forgot" && (
        <div className="segmented" role="group" aria-label="How to sign in">
          <button type="button" className="segmented__option" aria-pressed={mode === "password"} onClick={switchTo("password")}>
            Password
          </button>
          <button type="button" className="segmented__option" aria-pressed={mode === "link"} onClick={switchTo("link")}>
            Email me a link
          </button>
        </div>
      )}

      <TextField
        id="signin-email"
        name="email"
        type="email"
        label="Email address"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => { setEmail(event.target.value); }}
      />

      {mode === "password" && (
        <TextField
          id="signin-password"
          name="password"
          type="password"
          label="Password"
          required
          autoComplete="current-password"
        />
      )}

      <Button type="submit" size="lg" block pending={pending}>
        {pending
          ? "One moment…"
          : mode === "password"
            ? "Sign in"
            : mode === "forgot"
              ? "Email me a reset link"
              : "Email me a link"}
      </Button>

      {error !== null && <Notice tone="error">{error}</Notice>}

      <p className="auth__alt">
        {mode === "password" && (
          <button type="button" className="linklike" onClick={switchTo("forgot")}>
            Forgot your password?
          </button>
        )}
        {mode === "forgot" && (
          <button type="button" className="linklike" onClick={switchTo("password")}>
            Back to signing in
          </button>
        )}
        {mode === "link" && (
          <span className="muted">No password needed. Open the link in this browser to sign in.</span>
        )}
      </p>
    </form>
  );
};

const Sent = ({ title, children }: { readonly title: string; readonly children: React.ReactNode }) => (
  <div className="sent" role="status">
    <span className="sent__icon" aria-hidden>
      <Icon name="mail" size={26} />
    </span>
    <h2 className="heading">{title}</h2>
    <p className="lede">{children}</p>
    <p className="tiny">Nothing after a minute or two? Look in spam.</p>
  </div>
);
