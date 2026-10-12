"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type PrefetchKind = NonNullable<Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]>["kind"];

/**
 * Fetch the next screen, all of it, while this one is open.
 *
 * The wizard always knows where Keep, Continue and Skip lead, and they lead to
 * the same place. A plain `router.prefetch` on a dynamic page fetches only as
 * far as its loading screen — so the tap would show the skeleton, then the
 * step. `full` fetches the page itself, and the tap shows the real next
 * screen straight away.
 *
 * One page ahead and no further: it is the only one somebody is likely to
 * want, and each prefetch is a real render on the server.
 *
 * `PrefetchKind` is an enum Next does not export from a public path; its
 * values are the strings, so the string is spelled here and typed as theirs.
 */
export const usePrefetchNext = (href: string): void => {
  const router = useRouter();
  useEffect(() => {
    router.prefetch(href, { kind: "full" as unknown as PrefetchKind });
  }, [router, href]);
};
