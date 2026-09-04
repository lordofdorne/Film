"use client";

import { useEffect, useState } from "react";

/**
 * Say what actually happened to the link.
 *
 * When Supabase refuses one it redirects with the reason in the URL FRAGMENT —
 * `#error=access_denied&error_code=otp_expired` — which never reaches the
 * server. So the callback, seeing no code, can only say the vaguest true
 * thing: it did not recognise the link. The specific reason is sitting right
 * there in the browser, and only the browser can read it.
 *
 * Worth the component because the commonest cause is not the customer's fault
 * and not obvious: these tokens are single-use, and corporate mail scanners
 * follow links in incoming mail to check them. By the time the person clicks,
 * the link has already been spent by a machine. "Ask for another" is the right
 * advice, and it lands very differently when it comes with a reason.
 *
 * The server's own vaguer message is the fallback, rendered first and replaced
 * on hydration if the fragment has something better. One notice, never two.
 */
export const LinkTrouble = ({ fallback }: { readonly fallback?: string }) => {
  const [reason, setReason] = useState<string | null>(fallback ?? null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash === "") return;
    const code = new URLSearchParams(hash).get("error_code");
    if (code === null) return;

    setReason(
      code === "otp_expired"
        ? "That link had expired or had already been used — they are good for one sign-in, and some email systems open links before you do. Here is another."
        : "That link did not work. Ask for another below.",
    );

    // Clear it: a reload should not re-accuse a link the person has moved on
    // from, and the fragment is noise in a URL somebody might copy.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  if (reason === null) return null;
  return <p className="note note--warn">{reason}</p>;
};

