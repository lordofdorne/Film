"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startTheFilm } from "../../../src/server/captureActions.js";
import { SaveFilmSheet } from "./SaveFilmSheet.js";

/**
 * The bottom of the hub. Enabled by the same readiness that drew the cards —
 * the count shown here and the cards left open above it cannot disagree,
 * because both are walkthrough.missing.
 */
export const MakeFilmButton = ({
  projectId,
  stillMissing,
  suggestedEmail,
  pendingEmail,
}: {
  readonly projectId: string;
  readonly stillMissing: number;
  readonly suggestedEmail: string;
  readonly pendingEmail: string | null;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsAccount, setNeedsAccount] = useState(false);
  const ready = stillMissing === 0;

  // Made anonymously: the film is not handed over until there is an address
  // to keep it behind. The sheet's link hands it over when it is opened.
  if (needsAccount) {
    return (
      <SaveFilmSheet
        projectId={projectId}
        purpose="make"
        suggestedEmail={suggestedEmail}
        pendingEmail={pendingEmail}
      />
    );
  }

  return (
    <div className="row">
      <button
        type="button"
        disabled={!ready || pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await startTheFilm(projectId);
            if (result.ok) router.refresh();
            else if ("needsAccount" in result) setNeedsAccount(true);
            else setError(result.error);
          });
        }}
        className="btn btn--primary"
      >
        {pending ? "Handing it over…" : "Make my film"}
      </button>
      {!ready && (
        <span className="muted">
          {stillMissing === 1 ? "1 thing still needed" : `${String(stillMissing)} things still needed`}
        </span>
      )}
      {error !== null && <span className="note note--error">{error}</span>}
    </div>
  );
};

