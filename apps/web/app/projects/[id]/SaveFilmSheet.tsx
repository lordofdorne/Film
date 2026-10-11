"use client";

import { useState, useTransition } from "react";

import { saveFilm } from "../../../src/server/captureActions.js";
import { Button, Icon, TextField } from "../../../src/ui/index.js";
import { SetPasswordOffer } from "../../SetPasswordOffer.js";

/**
 * Save your film: the one place an account is asked for.
 *
 * Capture never asks — pressing Start must cost nothing. This appears at the
 * two moments the film starts to exist outside this browser: pressing "Make my
 * film" (`purpose: "make"`), and opening a film that was handed over before
 * this rule existed (`purpose: "watch"`). Either way it is their own film, so
 * it says so rather than pretending there is nothing here.
 *
 * The magic link stays first and the password sits beside it, as everywhere
 * else. The link is the one that carries the intent: opened, it proves the
 * address and — for "make" — hands the film over in the same step, so they
 * land on "we're making it" rather than on the button they already pressed.
 *
 * "In this browser" is load-bearing copy. The link completes a sign-in this
 * browser started, and opened somewhere else it fails as expired.
 */
export const SaveFilmSheet = ({
  projectId,
  purpose,
  suggestedEmail,
  pendingEmail,
}: {
  readonly projectId: string;
  readonly purpose: "make" | "watch";
  /** The address they gave the walk-through for where the film should go. */
  readonly suggestedEmail: string;
  /** A confirmation already in their inbox, from setting a password. */
  readonly pendingEmail: string | null;
}) => {
  const [pending, startTransition] = useTransition();
  const [sentTo, setSentTo] = useState<string | null>(pendingEmail);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await saveFilm(projectId, email, purpose === "make");
      if (result.ok) setSentTo(result.email);
      else setError(result.error);
    });
  };

  if (sentTo !== null) {
    return (
      <section className="save-film sent" aria-live="polite">
        <span className="sent__icon" aria-hidden>
          <Icon name="mail" size={26} />
        </span>
        <h2 className="title">Check your email</h2>
        <p className="lede">
          We sent a link to <strong>{sentTo}</strong>. Open it in this browser and{" "}
          {purpose === "make"
            ? "we will start making your film straight away."
            : "your film is yours to watch and download."}
        </p>
        <p className="muted">
          Nothing there after a minute? Look in spam, or{" "}
          <button type="button" className="linklike" onClick={() => { setSentTo(null); }}>
            send it again
          </button>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="save-film">
      <span className="sent__icon" aria-hidden>
        <Icon name="lock" size={26} />
      </span>
      <h2 className="title">
        {purpose === "make" ? "Save your film to make it" : "Save your film to watch it"}
      </h2>
      <p className="lede">
        {purpose === "make"
          ? "Everything you recorded is kept. Confirm your email and we will start on the film — and only you will be able to watch it."
          : "This film was made without an account, so it is locked to keep it private. Confirm your email and it is yours to watch and download."}
      </p>
      <form onSubmit={submit} className="auth__body" style={{ marginTop: 0 }}>
        <TextField
          id="save-film-email"
          name="email"
          type="email"
          label="Email address"
          required
          autoComplete="email"
          defaultValue={suggestedEmail}
        />
        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "Sending…" : "Email me a link"}
        </Button>
        {error !== null && <p className="note note--error" role="alert">{error}</p>}
      </form>
      <SetPasswordOffer defaultEmail={suggestedEmail} prompt="…or set a password instead" />
    </section>
  );
};
