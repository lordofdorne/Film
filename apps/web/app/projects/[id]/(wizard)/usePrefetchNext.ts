"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Fetch the next screen while this one is open.
 *
 * The wizard always knows where Keep, Continue and Skip lead, and they lead to
 * the same place, so it is fetched as soon as this screen is up. On a
 * production build that makes the tap near-instant: Skip measured 28–195 ms.
 *
 * Two things that look like improvements and are not, both found by timing a
 * production build with `pnpm perf` (the dev server never prefetches, so it
 * showed neither):
 *
 *   - `kind: "full"`, and
 *   - a `loading.tsx` inside the wizard layout.
 *
 * With either, a save that revalidates the film leaves the router unable to
 * move to the next step: Continue saved the name and stayed on the same
 * screen for good, by `router.push` and by a redirect from the action alike.
 * Removing each one, alone, made it work again.
 */
export const usePrefetchNext = (href: string): void => {
  const router = useRouter();
  useEffect(() => {
    router.prefetch(href);
  }, [router, href]);
};
