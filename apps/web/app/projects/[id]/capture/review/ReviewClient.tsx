"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startTheFilm } from "../../../../../src/server/captureActions.js";
import type { StepState } from "../../../../../src/server/capture.js";

/**
 * The last screen before it stops being editable.
 *
 * Everything is listed, including what is still missing, and one number
 * decides both the list and the button — so the page cannot cheerfully say
 * "all done" next to a control that refuses to work.
 */
export const ReviewClient = ({
  projectId,
  steps,
  missing,
}: {
  readonly projectId: string;
  readonly steps: readonly StepState[];
  readonly missing: readonly string[];
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ready = missing.length === 0;

  const finish = () => {
    setError(null);
    startTransition(async () => {
      const result = await startTheFilm(projectId);
      if (result.ok) router.push(`/projects/${projectId}`);
      else setError(result.error);
    });
  };

  let chapter = "";

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Everything you have given us</h1>
      <p style={styles.blurb}>
        Have a last look. Once you start the film, this stops being editable — the
        recordings go off to be cut together.
      </p>

      <ul style={styles.list}>
        {steps.map((step) => {
          const heading = step.chapterTitle === chapter ? null : step.chapterTitle;
          chapter = step.chapterTitle;
          return (
            <li key={step.id}>
              {heading !== null && <h2 style={styles.chapter}>{heading}</h2>}
              <a href={`/projects/${projectId}/capture/${step.id}`} style={styles.row}>
                <span style={styles.mark(step)}>{step.asset !== null ? "✓" : step.required ? "!" : "–"}</span>
                <span style={styles.ask}>{step.ask}</span>
                <span style={styles.state}>
                  {step.asset !== null ? "done" : step.required ? "still needed" : "skipped"}
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <section style={styles.footer}>
        <button
          type="button"
          onClick={finish}
          disabled={!ready || pending}
          style={{ ...styles.start, opacity: !ready || pending ? 0.5 : 1 }}
        >
          {pending ? "Starting…" : "Make my film"}
        </button>
        {!ready && (
          <p style={styles.muted}>
            {missing.length} thing{missing.length === 1 ? "" : "s"} still needed before the
            film can be made.
          </p>
        )}
        {error !== null && <p style={styles.error}>{error}</p>}
      </section>
    </main>
  );
};

const styles = {
  page: { maxWidth: 720, margin: "0 auto", padding: "40px 24px 96px", fontFamily: "system-ui, sans-serif", color: "#1a1a1a" },
  title: { fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.4 },
  blurb: { fontSize: 15, lineHeight: 1.6, color: "#666", margin: "12px 0 0" },
  list: { listStyle: "none", margin: "28px 0 0", padding: 0 },
  chapter: { fontSize: 12, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase" as const, color: "#12603a", margin: "24px 0 8px" },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderBottom: "1px solid #eee", textDecoration: "none", color: "inherit" },
  mark: (step: StepState) => ({
    width: 22,
    height: 22,
    flex: "0 0 auto",
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    background: step.asset !== null ? "#12603a" : step.required ? "#b45309" : "#c9c9c9",
  }),
  ask: { flex: 1, fontSize: 15, lineHeight: 1.4 },
  state: { fontSize: 13, color: "#999", whiteSpace: "nowrap" as const },
  footer: { marginTop: 36 },
  start: { background: "#12603a", color: "#fff", border: "none", borderRadius: 8, padding: "14px 28px", fontSize: 16, fontWeight: 600, cursor: "pointer" },
  muted: { color: "#777", fontSize: 13, margin: "10px 0 0" },
  error: { color: "#a11", fontSize: 14, margin: "10px 0 0" },
} as const;
