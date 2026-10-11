import Link from "next/link";

import { Button, Icon, Notice } from "../../../src/ui/index.js";
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
 *
 * It used to end by inviting a reply to "the email we sent you". No email is
 * sent — nothing sends mail yet — so that sentence is gone until one is.
 */
export const FailedNote = ({ projectId }: { readonly projectId: string }) => (
  <main className="page state-page">
    <span className="state-page__icon state-page__icon--warn" aria-hidden>
      <Icon name="alert" size={30} />
    </span>
    <h1 className="display">We could not finish this film</h1>
    <p className="lede">
      Something went wrong while putting it together, and it stopped rather than make you
      something broken.
    </p>
    <Notice tone="success" title="Nothing has been lost">
      Every recording and photograph you gave us is exactly where it was. The fault is in
      the making, not the material, and the film can be made again.
    </Notice>
    <div className="state-page__actions">
      <TryAgainButton projectId={projectId} />
      <Button variant="secondary" asChild>
        <Link href="/">Your films</Link>
      </Button>
    </div>
    <p className="muted">
      Sometimes trying again is all it takes. If it stops in the same place, the fault is
      ours to fix — we can see that it happened.
    </p>
  </main>
);
