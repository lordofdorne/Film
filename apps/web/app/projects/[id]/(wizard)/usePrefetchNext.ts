"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Fetch the next screen while this one is open.
 *
 * The wizard always knows where Keep, Continue and Skip lead, and they lead to
 * the same place, so it is fetched as soon as this screen is up.
 *
 * Deliberately the default kind, not `full`. A full prefetch would bring the
 * whole next page and make the tap show it outright — and on a production
 * build it broke navigation: once the next step had been fetched in full, a
 * save's `revalidatePath` left the router unable to go there at all, whether
 * by `router.push` or by a redirect from the action. Typing a name and
 * pressing Continue stayed on the same screen for good. Reproduced with
 * Playwright; blocking only that one prefetch made it work again. The dev
 * server never prefetches, which is why it looked fine there.
 *
 * The default prefetch brings the route down to its loading screen, and the
 * wizard has one, so the tap still changes the screen at once — the frame
 * stays and the step's skeleton shows (after 120 ms, so a fast answer never
 * flashes it) until the page arrives.
 */
export const usePrefetchNext = (href: string): void => {
  const router = useRouter();
  useEffect(() => {
    router.prefetch(href);
  }, [router, href]);
};
