"use client";

import Link from "next/link";

import { Button, Icon } from "../src/ui/index.js";

/**
 * Something broke while drawing a page. Said plainly, with the one thing that
 * matters most here: nothing anybody recorded is affected by a page failing
 * to draw.
 */
export default function ErrorPage({ reset }: { readonly error: Error; readonly reset: () => void }) {
  return (
    <main className="page state-page">
      <span className="state-page__icon state-page__icon--warn" aria-hidden>
        <Icon name="alert" size={30} />
      </span>
      <h1 className="display">That did not load</h1>
      <p className="lede">
        Something went wrong showing this page. Anything you have recorded is safe — this is
        a problem with the page, not your film.
      </p>
      <div className="state-page__actions">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" asChild>
          <Link href="/">Your films</Link>
        </Button>
      </div>
    </main>
  );
}
