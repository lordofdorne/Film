"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { tryAgain } from "../../../src/server/captureActions.js";
import { Button, Notice } from "../../../src/ui/index.js";

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
      <Notice tone="info" title="Trying again now">
        This page will change on its own when there is something to see. It usually takes a
        few minutes, and you can close it.
      </Notice>
    );
  }

  return (
    <>
      <Button size="lg" onClick={press} disabled={pending}>
        {pending ? "Starting…" : "Try making it again"}
      </Button>
      {outcome !== null && <Notice tone="error">{outcome}</Notice>}
    </>
  );
};
