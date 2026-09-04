"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { submitDetail } from "../../../../../src/server/captureActions.js";
import type { StepView } from "../../../../../src/server/capture.js";
import { SetPasswordOffer } from "../../../../SetPasswordOffer.js";

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
  const [linkSentTo, setLinkSentTo] = useState<{ email: string; already: boolean } | null>(null);

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
        setLinkSentTo({ email: result.linkSentTo, already: result.already });
        return;
      }
      router.push(`/projects/${projectId}`);
    });
  };

  if (linkSentTo !== null) {
    return (
      <main className="page page--narrow stack-4">
        <span className="eyebrow">{step.chapterTitle}</span>
        <h1 className="title">One click, whenever suits</h1>
        <p className="lede">
          {linkSentTo.already ? (
            <>
              There is already a link waiting in <strong>{linkSentTo.email}</strong> from
              when you set a password. Open that one — it does the same job, and a
              second would make a second account.
            </>
          ) : (
            <>
              We sent a link to <strong>{linkSentTo.email}</strong>. Clicking it signs you
              in, so this film is yours from any phone or laptop — and it is how we send
              the finished thing. No rush; everything here keeps working meanwhile.
            </>
          )}
        </p>
        {!linkSentTo.already && (
          /* Beside the link, never in front of it. Nothing here waits on it. */
          <SetPasswordOffer
            defaultEmail={linkSentTo.email}
            prompt="…or set a password now, so you can just sign in"
          />
        )}
        <Link href={`/projects/${projectId}`} className="btn btn--primary">
          Back to the film
        </Link>
      </main>
    );
  }

  return (
    <main className="page page--narrow stack-4">
      <span className="eyebrow">{step.chapterTitle}</span>
      <h1 className="title">{step.ask}</h1>
      {step.coaching !== undefined && <p className="lede">{step.coaching}</p>}
      {step.examples !== undefined && step.examples.length > 0 && (
        <ul className="list examples">
          {step.examples.map((example) => (
            <li key={example} className="example">{example}</li>
          ))}
        </ul>
      )}

      <div className="row">
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
          className="input"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn btn--primary"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error !== null && <p className="note note--error">{error}</p>}

      <nav className="row step-nav">
        <Link href={`/projects/${projectId}`} className="btn btn--quiet">
          Back to the film
        </Link>
        {!step.required && <span className="tiny">optional — leave it empty if you like</span>}
      </nav>
    </main>
  );
};

