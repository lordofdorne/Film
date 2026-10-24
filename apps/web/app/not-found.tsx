import Link from "next/link";

import { Button, Icon } from "../src/ui/index.js";

export const metadata = { title: "Not found" };

/**
 * Also what somebody sees for a film that is not theirs — on purpose, so a
 * guessed address learns nothing about whether a film is there. The copy
 * therefore never says "this film does not exist".
 */
export default function NotFound() {
  return (
    <main className="page state-page">
      <span className="state-page__icon" aria-hidden>
        <Icon name="film" size={30} />
      </span>
      <h1 className="display">Nothing here</h1>
      <p className="lede">
        This page does not exist, or it belongs to somebody else. If you followed a link to
        your own film, sign in to the account you made it with.
      </p>
      <div className="state-page__actions">
        <Button asChild>
          <Link href="/">Your films</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/signin">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
