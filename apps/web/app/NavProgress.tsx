"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Something moves the instant a tap lands, whatever the next screen costs.
 *
 * Before this, every tap that went to the server left the screen exactly as it
 * was until the whole next page arrived: no pressed state, no bar, nothing.
 * On a production build most taps take a tenth of a second and nobody
 * notices; on a phone with a weak signal, or on the dev server, the same tap
 * takes seconds and reads as broken.
 *
 * Two signals, both from one place rather than from every link in the app:
 *   - a thin bar across the top of the screen, and
 *   - `data-pending` + `aria-busy` on the link that was tapped, which the
 *     stylesheet turns into a spinner on a button and a dimmed card otherwise.
 *
 * Both are held back by CSS for the first ~120 ms, so a tap that answers that
 * fast never flashes anything — the same rule the skeletons follow.
 *
 * Not `loading.tsx` above the wizard: that broke Continue on production builds
 * (see usePrefetchNext). This touches no routing at all; it only watches.
 */

/** Started by code that navigates without a link: `router.push` after a save. */
let begin: (() => void) | null = null;
let end: (() => void) | null = null;
export const startNavigation = (): void => {
  begin?.();
};
/** ...and stopped by it when the save said no and nobody is going anywhere. */
export const stopNavigation = (): void => {
  end?.();
};

/**
 * `router.push` that says so: the bar starts, and `leaving` stays true until
 * the next screen is showing, so the button pressed can keep its spinner.
 *
 * A transition's `isPending` is no use for this: it ends when `push` returns,
 * which is long before the next screen has arrived.
 */
export const useNavigate = (): { readonly leaving: boolean; readonly go: (href: string) => void } => {
  const router = useRouter();
  const path = usePathname();
  const [leaving, setLeaving] = useState(false);
  // Arrived: a step's screen is often the same component with new props, so
  // this has to be reset rather than left to an unmount.
  useEffect(() => {
    setLeaving(false);
  }, [path]);
  return {
    leaving,
    go: (href: string) => {
      setLeaving(true);
      startNavigation();
      router.push(href);
    },
  };
};

/** A tap that never arrives somewhere stops claiming to be on its way. */
const GIVE_UP_MS = 15_000;

export const NavProgress = () => {
  const path = usePathname();
  const [active, setActive] = useState(false);
  const pending = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current?.removeAttribute("data-pending");
    pending.current?.removeAttribute("aria-busy");
    pending.current = null;
    setActive(false);
  };

  const start = (from?: HTMLElement) => {
    finish();
    if (from !== undefined) {
      from.setAttribute("data-pending", "");
      from.setAttribute("aria-busy", "true");
      pending.current = from;
    }
    setActive(true);
    timer.current = setTimeout(finish, GIVE_UP_MS);
  };

  // Arriving anywhere ends it. Browser Back lands here too.
  useEffect(() => {
    finish();
  }, [path]);

  useEffect(() => {
    begin = () => {
      start();
    };
    end = finish;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target !== "" && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;
      const to = new URL(link.href, location.href);
      if (to.origin !== location.origin) return;
      // Same page, or only a #fragment: nothing is coming.
      if (to.pathname === location.pathname && to.search === location.search) return;
      // A route handler that answers with a file, not a screen.
      if (/\/download$/.test(to.pathname)) return;
      start(link);
    };
    // Capture phase: before Next's Link handler, so even a tap it answers from
    // the prefetch cache is seen.
    document.addEventListener("click", onClick, true);
    return () => {
      begin = null;
      end = null;
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return <div className={active ? "nav-progress nav-progress--on" : "nav-progress"} aria-hidden="true" />;
};
