"use client";

import { useEffect, useState } from "react";

import { Notice } from "../../../src/ui/index.js";

/**
 * Lost signal, said before it costs anything.
 *
 * Capture happens in kitchens and care homes, on phones with one bar. A take
 * recorded offline still exists in the page, but saving it will fail — and
 * finding that out after a ten-minute answer is the worst moment to. So the
 * wizard says so the moment the browser knows, and says what is safe.
 */
export const OfflineNotice = () => {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => { setOffline(!navigator.onLine); };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="wz-offline">
      <Notice tone="warn" title="You are offline">
        Everything already saved is safe. New recordings will not save until the connection
        is back — keep this page open and try again then.
      </Notice>
    </div>
  );
};
