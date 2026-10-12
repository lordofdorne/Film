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
 * What looks like an improvement and is not, found by timing a production
 * build with `pnpm perf` (the dev server never prefetches, so it showed
 * nothing): a `loading.tsx` anywhere above a step — the site-wide one or the
 * wizard's own. With one there, a save that revalidates the film often left
 * the router unable to move on: Continue saved the name and stayed on the same
 * screen for good, by `router.push` and by a redirect from the action alike.
 * Bisected over production builds — `main` and this layout passed 4 of 4,
 * every build with a loading screen above the step failed intermittently, and
 * the branch with the site-wide one removed passed 5 of 5. So there are none,
 * and this is the default prefetch rather than `kind: "full"`, which was the
 * first suspect and is not needed either.
 */
export const usePrefetchNext = (href: string): void => {
  const router = useRouter();
  useEffect(() => {
    router.prefetch(href);
  }, [router, href]);
};
