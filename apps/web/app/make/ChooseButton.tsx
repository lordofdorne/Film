"use client";

import { useState, useTransition } from "react";

import { startNavigation, stopNavigation } from "../NavProgress.js";
import { chooseFilm, type StartResult } from "../../src/server/captureActions.js";
import { Button, Icon, Notice } from "../../src/ui/index.js";

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
    <div className="stack">
      <Button
        size="lg"
        block
        pending={pending}
        onClick={() => {
          setError(null);
          startNavigation();
          startTransition(async () => {
            // Success redirects from the server, in which case nothing comes
            // back here at all; only a failure resolves with a value.
            const result: StartResult | undefined = await chooseFilm(templateId, templateVersion);
            if (result !== undefined && !result.ok) {
              stopNavigation();
              setError(result.error);
            }
          });
        }}
      >
        {pending ? "Setting up…" : "Start this film"}
        {!pending && <Icon name="forward" size={18} />}
      </Button>
      {error !== null && <Notice tone="error" title="That did not start">{error}</Notice>}
    </div>
  );
};
