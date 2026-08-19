"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-render the hub when somebody comes back to the tab.
 *
 * Two things go stale while a phone is in a pocket, and this fixes both with
 * the same line.
 *
 * The one that would otherwise break: every thumbnail on this page is a signed
 * URL minted at render time and good for fifteen minutes, because the bucket
 * is private and always will be — these are recordings of somebody's
 * grandmother. Leave the hub open through lunch and come back, and the images
 * are 403s. Re-rendering re-signs them.
 *
 * The one that is merely nice: ingest runs while the camera is still up, so a
 * QC note — "we could barely hear that one" — often lands a few seconds after
 * the card was drawn. Coming back to the tab is exactly when somebody wants to
 * see it.
 *
 * Cheap on purpose: no polling, no interval. It fires when the tab becomes
 * visible again, which is the only moment anybody is looking.
 */
export const FreshenOnReturn = () => {
  const router = useRouter();

  useEffect(() => {
    const freshen = (): void => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", freshen);
    window.addEventListener("focus", freshen);
    return () => {
      document.removeEventListener("visibilitychange", freshen);
      window.removeEventListener("focus", freshen);
    };
  }, [router]);

  return null;
};
