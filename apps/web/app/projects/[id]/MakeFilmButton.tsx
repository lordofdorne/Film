"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startTheFilm } from "../../../src/server/captureActions.js";
import { useUploadSummary } from "./CaptureProvider.js";

/**
 * The bottom of the hub. Enabled by the same readiness that drew the cards —
 * the count shown here and the cards left open above it cannot disagree,
 * because both are walkthrough.missing.
 */
export const MakeFilmButton = ({
  projectId,
  stillMissing,
}: {
  readonly projectId: string;
  readonly stillMissing: number;
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
            else setError(result.error);
          });
        }}
        className="btn btn--primary"
      >
        {pending
          ? "Handing it over…"
          : saving > 0
            ? `Saving ${saving === 1 ? "1 take" : `${String(saving)} takes`}…`
            : "Make my film"}
      </button>
      {stillMissing > 0 && (
        <span className="muted">
          {stillMissing === 1 ? "1 thing still needed" : `${String(stillMissing)} things still needed`}
        </span>
      )}
      {error !== null && <span className="note note--error">{error}</span>}
    </div>
  );
};

