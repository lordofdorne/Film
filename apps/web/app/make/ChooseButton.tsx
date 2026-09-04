"use client";

import { useState, useTransition } from "react";

import { chooseFilm, type StartResult } from "../../src/server/captureActions.js";

/**
 * One press creates the project and lands on its hub. A client component only
 * because a press needs a pending state — creating a project takes a moment,
 * and a button that seems to do nothing is exactly the bug this redesign
 * started from.
 */
export const ChooseButton = ({
  templateId,
  templateVersion,
}: {
  readonly templateId: string;
  readonly templateVersion: number;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="row">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            // Success redirects from the server, in which case nothing comes
            // back here at all; only a failure resolves with a value.
            const result: StartResult | undefined = await chooseFilm(templateId, templateVersion);
            if (result !== undefined && !result.ok) setError(result.error);
          });
        }}
        className="btn btn--primary"
      >
        {pending ? "Setting up…" : "Start"}
      </button>
      {error !== null && <span className="note note--error">{error}</span>}
    </span>
  );
};

