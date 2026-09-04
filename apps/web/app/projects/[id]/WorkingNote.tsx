"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Between capture and preview: the film is handed over and compose has not
 * written a cut yet. Checks again every few seconds so the preview appears on
 * its own — nobody should have to know that refreshing is a thing.
 */
export const WorkingNote = () => {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [router]);

  return (
    <main className="page stack-4 centred">
      <h1 className="title">Putting your film together</h1>
      <p className="lede">
        Everything arrived. The first cut usually takes a few minutes — this page
        will update itself when it is ready to watch.
      </p>
    </main>
  );
};

