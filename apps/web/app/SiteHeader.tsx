import Link from "next/link";

import { PRODUCT_NAME } from "../src/product.js";
import { authConfigured, sessionIdentity } from "../src/server/auth.js";
import { SignOutButton } from "./SignOutButton.js";

/**
 * The same header on every page, which is most of what "a product rather than
 * a project" means in practice.
 *
 * Before this, each page began wherever its own `<main>` began: the hub, the
 * chooser and the sign-in form shared no frame, no way back and no indication
 * of who you were. Whether you were signed in was stated on the home page and
 * nowhere else — so somebody who followed a link into a step sheet could not
 * tell whose films these were, or how to get out.
 *
 * Deliberately quiet: a name that goes home, and the truth about your session.
 * Nothing here competes with the film.
 */
export const SiteHeader = async () => {
  const identity = await sessionIdentity();
  const open = !authConfigured();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-header__mark">
          {PRODUCT_NAME}
        </Link>

        <div className="site-header__who">
          {open ? (
            /* An unconfigured server says so on every page, not just at home. */
            <span>No sign-in on this server</span>
          ) : identity?.email !== null && identity?.email !== undefined ? (
            <>
              <span>{identity.email}</span>
              <span aria-hidden>·</span>
              <Link href="/account/password" className="btn btn--quiet">
                Password
              </Link>
              <SignOutButton />
            </>
          ) : identity?.pendingEmail !== null && identity?.pendingEmail !== undefined ? (
            <>
              <span>Confirm {identity.pendingEmail}</span>
              <SignOutButton />
            </>
          ) : (
            /**
             * An anonymous session is the ordinary case — pressing Start makes
             * one — and the honest thing to say is where the films are kept,
             * because clearing this browser really does lose them.
             */
            <>
              <span>Kept in this browser</span>
              <Link href="/signin" className="btn btn--quiet">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
