"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { submitDetail } from "../../../../../src/server/captureActions.js";
import type { StepView } from "../../../../../src/server/capture.js";

/**
 * A typed answer, dressed exactly like a capture: the ask, the coaching, one
 * input, done. "What do you call them?" must not feel like a form after "Add
 * a photo of the person from another time" felt like a conversation.
 */
export const DetailStepClient = ({
  projectId,
  step,
}: {
  readonly projectId: string;
  readonly step: StepView;
}) => {
  const router = useRouter();
  const [value, setValue] = useState(step.value === null ? "" : String(step.value));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);

  const inputType =
    step.field?.kind === "number" ? "number" : step.field?.kind === "email" ? "email" : "text";

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitDetail(projectId, step.id, value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.linkSentTo !== null) {
        // Stay: the one message worth reading before going back.
        setLinkSentTo(result.linkSentTo);
        return;
      }
      router.push(`/projects/${projectId}`);
    });
  };

  if (linkSentTo !== null) {
    return (
      <main style={styles.page}>
        <span style={styles.chapter}>{step.chapterTitle}</span>
        <h1 style={styles.ask}>One click, whenever suits</h1>
        <p style={styles.coaching}>
          We sent a link to <strong>{linkSentTo}</strong>. Clicking it signs you in, so
          this film is yours from any phone or laptop — and it is how we send the
          finished thing. No rush; everything here keeps working meanwhile.
        </p>
        <Link href={`/projects/${projectId}`} style={styles.primaryLink}>
          Back to the film
        </Link>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <span style={styles.chapter}>{step.chapterTitle}</span>
      <h1 style={styles.ask}>{step.ask}</h1>
      {step.coaching !== undefined && <p style={styles.coaching}>{step.coaching}</p>}
      {step.examples !== undefined && step.examples.length > 0 && (
        <ul style={styles.examples}>
          {step.examples.map((example) => (
            <li key={example} style={styles.example}>{example}</li>
          ))}
        </ul>
      )}

      <div style={styles.row}>
        <input
          type={inputType}
          value={value}
          autoFocus
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
          style={styles.input}
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          style={{ ...styles.save, opacity: pending ? 0.6 : 1 }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error !== null && <p style={styles.error}>{error}</p>}

      <nav style={styles.nav}>
        <Link href={`/projects/${projectId}`} style={styles.back}>
          Back to the film
        </Link>
        {!step.required && <span style={styles.optional}>optional — leave it empty if you like</span>}
      </nav>
    </main>
  );
};

const styles = {
  page: {
    maxWidth: 620,
    margin: "0 auto",
    padding: "40px 24px 80px",
    fontFamily: "system-ui, sans-serif",
    color: "#1a1a1a",
  },
  chapter: {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    color: "#12603a",
  },
  ask: { fontSize: 26, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.4, margin: "16px 0 0" },
  coaching: { fontSize: 16, lineHeight: 1.6, color: "#555", margin: "12px 0 0" },
  examples: { display: "flex", flexWrap: "wrap" as const, gap: 8, listStyle: "none", padding: 0, margin: "14px 0 0" },
  example: { fontSize: 13, color: "#5c4a33", background: "#fdf6ec", border: "1px solid #f0dcc0", borderRadius: 999, padding: "4px 12px" },
  row: { display: "flex", gap: 10, marginTop: 26, flexWrap: "wrap" as const },
  input: {
    flex: 1,
    minWidth: 220,
    fontSize: 17,
    padding: "12px 14px",
    border: "1px solid #ccc",
    borderRadius: 8,
  },
  save: {
    background: "#12603a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 26px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { fontSize: 14, color: "#a11", margin: "10px 0 0" },
  nav: { display: "flex", alignItems: "baseline", gap: 14, marginTop: 34, flexWrap: "wrap" as const },
  back: { color: "#666", textDecoration: "none", fontSize: 15 },
  optional: { fontSize: 13, color: "#999" },
  primaryLink: {
    display: "inline-block",
    marginTop: 26,
    background: "#12603a",
    color: "#fff",
    borderRadius: 8,
    padding: "12px 26px",
    fontSize: 15,
    fontWeight: 600,
    textDecoration: "none",
  },
} as const;
