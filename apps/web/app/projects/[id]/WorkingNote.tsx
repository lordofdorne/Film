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
    <main style={styles.page}>
      <h1 style={styles.title}>Putting your film together</h1>
      <p style={styles.blurb}>
        Everything arrived. The first cut usually takes a few minutes — this page
        will update itself when it is ready to watch.
      </p>
    </main>
  );
};

const styles = {
  page: {
    maxWidth: 620,
    margin: "0 auto",
    padding: "96px 24px",
    fontFamily: "system-ui, sans-serif",
    color: "#1a1a1a",
    textAlign: "center" as const,
  },
  title: { fontSize: 26, fontWeight: 600, letterSpacing: -0.4, margin: 0 },
  blurb: { fontSize: 16, lineHeight: 1.6, color: "#555", margin: "14px 0 0" },
} as const;
