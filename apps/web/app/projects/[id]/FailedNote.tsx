import Link from "next/link";

import { TryAgainButton } from "./TryAgainButton.js";

/**
 * The film could not be made, and saying so is the whole job.
 *
 * This page used to show "Putting your film together" for a project that had
 * already failed — because the check was "is there a cut yet", and a project
 * that died before compose has no cut and never will. So it sat there
 * refreshing itself every five seconds, reassuring somebody, for ever, while
 * the home page listed the same film as failed. Two screens disagreeing about
 * the same row, and the comforting one was the lie.
 *
 * What it must not say is "sorry, it is gone". Nothing IS gone: every
 * recording is in storage untouched, the failure is in the making of the film
 * and not in the material, and it can be made again once the fault is fixed.
 * That is the difference between a bad afternoon and a bereavement, and it
 * belongs on the screen.
 */
export const FailedNote = ({ projectId }: { readonly projectId: string }) => (
  <main className="page stack-4">
    <h1 className="title">We could not finish this film</h1>
    <p className="lede">
      Something went wrong while putting it together, and it stopped rather than
      making you something broken.
    </p>
    <p className="note note--quiet">
      <strong>Nothing has been lost.</strong> Every recording and photograph you gave
      us is exactly where it was — the fault is in the making, not the material, and
      the film can be made again once it is fixed.
    </p>
    <div className="row">
      <TryAgainButton projectId={projectId} />
    </div>
    <p className="lede">
      Sometimes that is all it takes. If it stops in the same place, the fault is
      one we have to fix at our end — we can see that this happened, and you can
      reply to the email we sent you to hurry us along.
    </p>
    <nav className="row">
      <Link href="/" className="btn btn--secondary">
        Your films
      </Link>
    </nav>
  </main>
);

