"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { tryAgain } from "../../../src/server/captureActions.js";

/**
 * The one thing a person could not do about a film that would not finish.
 *
 * The page told them it had stopped, and offered them two links back to where
 * they came from. The only thing on earth that could move the film was
 * somebody with a database client, which is not a product.
 *
 * It promises nothing it cannot keep. Most retries of a stuck film fail the
 * same way — the fault is usually in one file or one recipe, and neither
 * changes because somebody pressed a button — so the copy says "try" and the
 * result says what happened. Pretending otherwise would spend the trust this
 * screen is already low on.
 */
export const TryAgainButton = ({ projectId }: { readonly projectId: string }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<"started" | string | null>(null);

  const press = () => {
    setOutcome(null);
    startTransition(async () => {
      const result = await tryAgain(projectId);
      if (result.ok) {
        setOutcome("started");
        // The page re-renders as "putting your film together" on its own once
        // the pipeline picks it up; refreshing gets them there without a
        // second press.
        router.refresh();
        return;
      }
      setOutcome(result.error);
    });
  };

  if (outcome === "started") {
    return (
      <p className="note note--quiet">
        We are trying again now. This page will change on its own when there is
        something to see — it usually takes a few minutes, and you can close it.
      </p>
    );
  }

  return (
    <>
      <button type="button" onClick={press} disabled={pending} className="btn btn--primary">
        {pending ? "Starting…" : "Try making it again"}
      </button>
      {outcome !== null && <p className="note note--error">{outcome}</p>}
    </>
  );
};

