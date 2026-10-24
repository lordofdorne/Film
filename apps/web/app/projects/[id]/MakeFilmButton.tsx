"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startTheFilm } from "../../../src/server/captureActions.js";
import { Sheet } from "../../../src/ui/index.js";
import { AccountForm } from "../../AccountForm.js";
import { useUploadSummary } from "./CaptureProvider.js";

/**
 * The bottom of the hub. Enabled by the same readiness that drew the cards —
 * the count shown here and the cards left open above it cannot disagree,
 * because both are walkthrough.missing.
 *
 * Making the film needs an account. Somebody already signed in to one presses
 * it and the film starts. Anybody else — everyone who made this film without
 * signing in, which is most people — gets a sheet: create an account or sign
 * in, and the film starts in the same step. The finished film is watched and
 * downloaded from that account.
 */
export const MakeFilmButton = ({
  projectId,
  stillMissing,
  hasAccount,
}: {
  readonly projectId: string;
  readonly stillMissing: number;
  readonly hasAccount: boolean;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /**
   * Takes still going up are not in the film yet. Handing it over now would
   * cut it without them, so the button waits and says why.
   */
  const uploads = useUploadSummary();
  const saving = uploads.pending - uploads.failed;
  const ready = stillMissing === 0 && saving === 0;

  const label = pending
    ? "Handing it over…"
    : saving > 0
      ? `Saving ${saving === 1 ? "1 take" : `${String(saving)} takes`}…`
      : "Make my film";

  return (
    <div className="row">
      {hasAccount || !ready ? (
        <button
          type="button"
          disabled={!ready || pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await startTheFilm(projectId);
              if (result.ok) router.refresh();
              else setError(result.error);
            });
          }}
          className="btn btn--primary"
        >
          {label}
        </button>
      ) : (
        <Sheet
          title="Create an account to make your film"
          description="Your film is kept in your account. Sign in to it to watch and download it, from any phone or computer."
          trigger={
            <button type="button" className="btn btn--primary">
              {label}
            </button>
          }
        >
          <AccountForm
            initial="create"
            next={`/projects/${projectId}`}
            makeFilm={projectId}
            submitLabel={{ create: "Create account and make my film", signin: "Sign in and make my film" }}
          />
        </Sheet>
      )}
      {stillMissing > 0 && (
        <span className="muted">
          {stillMissing === 1 ? "1 thing still needed" : `${String(stillMissing)} things still needed`}
        </span>
      )}
      {error !== null && <span className="note note--error">{error}</span>}
    </div>
  );
};
