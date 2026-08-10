"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startProject } from "../../src/server/captureActions.js";

/**
 * Step zero of the walk-through, not an admin screen.
 *
 * Every field here is used: the name and age are interpolated into the film's
 * titles ("94 years of stories"), the relationship into its opening line, and
 * the interviewer's name into the bonus question. None of it is being
 * collected because a form felt necessary — a project cannot be worded without
 * it, and today it is typed into a JSON file by hand.
 */
export const StartForm = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string): string => String(form.get(name) ?? "");

    setError(null);
    startTransition(async () => {
      const result = await startProject({
        ownerEmail: read("email"),
        subjectName: read("subjectName"),
        displayName: read("displayName"),
        age: Number(read("age")),
        relationshipLabel: read("relationshipLabel"),
        interviewerName: read("interviewerName"),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/projects/${result.projectId}/capture`);
    });
  };

  return (
    <form onSubmit={submit} style={styles.form}>
      <Field
        name="subjectName"
        label="Who is the film about?"
        hint="Their full name, as it should appear if it is ever written down."
        placeholder="Ada Lovelace"
        required
      />
      <Field
        name="displayName"
        label="What do you call them?"
        hint="Used in the closing line — “love you Nana”. Leave it blank to use their name."
        placeholder="Nana"
      />
      <Field
        name="age"
        label="How old are they?"
        hint="The film is titled from this: “94 years of stories”."
        placeholder="94"
        type="number"
        required
      />
      <Field
        name="relationshipLabel"
        label="What are they to you?"
        hint="Opens the film — “I interviewed my 94 year old grandmother”."
        placeholder="grandmother"
      />
      <Field
        name="interviewerName"
        label="And your name?"
        hint="Only used for the optional last question, where you ask what they think of you."
        placeholder="Asim"
      />
      <Field
        name="email"
        label="Where should we send the film?"
        hint="Also how you find your way back to this film later."
        placeholder="you@example.com"
        type="email"
        required
      />

      <button type="submit" disabled={pending} style={{ ...styles.submit, opacity: pending ? 0.5 : 1 }}>
        {pending ? "Starting…" : "Start"}
      </button>
      {error !== null && <p style={styles.error}>{error}</p>}
    </form>
  );
};

const Field = ({
  name,
  label,
  hint,
  placeholder,
  type = "text",
  required = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly placeholder: string;
  readonly type?: string;
  readonly required?: boolean;
}) => (
  <label style={styles.field}>
    <span style={styles.label}>
      {label}
      {!required && <span style={styles.optional}> optional</span>}
    </span>
    <input
      name={name}
      type={type}
      placeholder={placeholder}
      required={required}
      style={styles.input}
      autoComplete="off"
    />
    <span style={styles.hint}>{hint}</span>
  </label>
);

const styles = {
  form: { display: "flex", flexDirection: "column", gap: 22, marginTop: 28 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 15, fontWeight: 600 },
  optional: { fontWeight: 400, color: "#999", fontSize: 13 },
  input: {
    fontSize: 16,
    padding: "10px 12px",
    border: "1px solid #d6d6d6",
    borderRadius: 8,
    fontFamily: "inherit",
  },
  hint: { fontSize: 13, color: "#777", lineHeight: 1.45 },
  submit: {
    background: "#12603a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "13px 22px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
  error: { color: "#a11", fontSize: 14, margin: 0 },
} as const;
