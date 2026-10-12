"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { submitDetail } from "../../../../../../src/server/captureActions.js";
import type { StepView } from "../../../../../../src/server/capture.js";
import { usePrefetchNext } from "../../usePrefetchNext.js";
import { Button, Chip, Icon, Tip } from "../../../../../../src/ui/index.js";
import { startNavigation, stopNavigation, useNavigate } from "../../../../../NavProgress.js";
import { SetPasswordOffer } from "../../../../../SetPasswordOffer.js";

/**
 * A typed answer, dressed exactly like a capture: the ask, the coaching, one
 * big input, Continue. "What do you call them?" must not feel like a form
 * after "Add a photo of the person from another time" felt like a
 * conversation.
 *
 * Enter continues, because on a phone keyboard the return key is the obvious
 * thing to press after typing a name.
 */
export const DetailStepClient = ({
  projectId,
  step,
  nextHref,
}: {
  readonly projectId: string;
  readonly step: StepView;
  readonly nextHref: string;
}) => {
  const initial = step.value === null ? "" : String(step.value);
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { leaving, go } = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<{ email: string; already: boolean } | null>(null);

  // The next screen is known; fetch it now so Continue feels instant.
  usePrefetchNext(nextHref);

  const inputType =
    step.field?.kind === "number" ? "number" : step.field?.kind === "email" ? "email" : "text";
  const autoComplete = step.field?.kind === "email" ? "email" : "off";
  const empty = value.trim() === "";

  const save = () => {
    // Unchanged is not a save: go on without a round trip.
    if (value === initial && !empty) {
      go(nextHref);
      return;
    }
    setError(null);
    startNavigation();
    startTransition(async () => {
      // Saved and nothing to say: the action sends us on (see submitDetail).
      const result = await submitDetail(projectId, step.id, value, nextHref);
      if (!result.ok) {
        stopNavigation();
        setError(result.error);
        return;
      }
      if (result.linkSentTo !== null) {
        // Stay: the one message worth reading before moving on.
        stopNavigation();
        setLinkSentTo({ email: result.linkSentTo, already: result.already });
        return;
      }
      go(nextHref);
    });
  };

  if (linkSentTo !== null) {
    return (
      <>
        <main className="wz-body">
          <p className="eyebrow wz-eyebrow">{step.chapterTitle}</p>
          <h1 className="wz-ask">One click, whenever suits</h1>
          <p className="lede">
            {linkSentTo.already ? (
              <>
                There is already a link waiting in <strong>{linkSentTo.email}</strong> from when
                you set a password. Open that one — it does the same job, and a second would
                make a second account.
              </>
            ) : (
              <>
                We sent a link to <strong>{linkSentTo.email}</strong>. Opening it saves this film
                to your email, so it is yours on any phone or laptop. No rush — carry on, and
                open it whenever suits.
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
        </main>
        <footer className="wz-foot">
          <div className="wz-foot__row">
            <Button size="lg" asChild className="wz-foot__main">
              <Link href={nextHref}>
                Continue
                <Icon name="forward" size={18} />
              </Link>
            </Button>
          </div>
        </footer>
      </>
    );
  }

  const inputId = `detail-${step.id}`;

  return (
    <>
      <main className="wz-body">
        <p className="eyebrow wz-eyebrow">{step.chapterTitle}</p>
        {/* The page's heading and the field's label at once: a screen reader
            lands on the question, and the input is named by it. */}
        <h1 className="wz-ask">
          <label htmlFor={inputId}>{step.ask}</label>
        </h1>
        {step.coaching !== undefined && <Tip>{step.coaching}</Tip>}
        {step.examples !== undefined && step.examples.length > 0 && (
          <div className="wz-examples">
            {step.examples.map((example) => (
              <Chip key={example}>{example}</Chip>
            ))}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            id={inputId}
            type={inputType}
            inputMode={inputType === "number" ? "numeric" : undefined}
            autoComplete={autoComplete}
            enterKeyHint="next"
            value={value}
            autoFocus
            onChange={(event) => {
              setValue(event.target.value);
            }}
            className="ui-input ui-input--xl"
          />
        </form>
        {!step.required && <p className="muted">Optional — leave it empty if you like.</p>}
        {error !== null && (
          <p className="note note--error" role="alert">
            {error}
          </p>
        )}
      </main>

      <footer className="wz-foot">
        <div className="wz-foot__row">
          <Button variant="quiet" asChild>
            <Link href={nextHref}>Skip for now</Link>
          </Button>
          <Button size="lg" onClick={save} pending={pending || leaving} disabled={step.required && empty}>
            {pending ? "Saving…" : "Continue"}
            {!pending && !leaving && <Icon name="forward" size={18} />}
          </Button>
        </div>
      </footer>
    </>
  );
};
