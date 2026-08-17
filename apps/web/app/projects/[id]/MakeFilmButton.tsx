"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startTheFilm } from "../../../src/server/captureActions.js";

/**
 * The bottom of the hub. Enabled by the same readiness that drew the cards —
 * the count shown here and the cards left open above it cannot disagree,
 * because both are walkthrough.missing.
 */
export const MakeFilmButton = ({
  projectId,
  stillMissing,
}: {
  readonly projectId: string;
  readonly stillMissing: number;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ready = stillMissing === 0;

  return (
    <div style={styles.holder}>
      <button
        type="button"
        disabled={!ready || pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await startTheFilm(projectId);
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
        style={{ ...styles.button, opacity: ready && !pending ? 1 : 0.45 }}
      >
        {pending ? "Handing it over…" : "Make my film"}
      </button>
      {!ready && (
        <span style={styles.hint}>
          {stillMissing === 1 ? "1 thing still needed" : `${String(stillMissing)} things still needed`}
        </span>
      )}
      {error !== null && <span style={styles.error}>{error}</span>}
    </div>
  );
};

const styles = {
  holder: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" as const },
  button: {
    background: "#12603a",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "14px 30px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  hint: { fontSize: 14, color: "#888" },
  error: { fontSize: 14, color: "#a11" },
} as const;
