import Link from "next/link";

import { PRODUCT_NAME } from "../src/product.js";
import { authConfigured, sessionClaims } from "../src/server/auth.js";
import { Avatar, Button, Logo } from "../src/ui/index.js";

/**
 * The same header on every page outside the wizard: the name, going home, and
 * the truth about your session in as few words as possible.
 *
 * Signed in, it is "Your films" and an avatar that opens the account page —
 * the sign-out and the password live there rather than crowding every page.
 * Not signed in — including somebody making a film anonymously — it is one
 * button.
 */
export const SiteHeader = async () => {
  const identity = await sessionClaims();
  const open = !authConfigured();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-header__mark" aria-label={`${PRODUCT_NAME} — home`}>
          <Logo />
          <span aria-hidden>{PRODUCT_NAME}</span>
        </Link>

        <nav className="site-header__who" aria-label="Account">
          {open ? (
            /* An unconfigured server says so on every page, not just at home. */
            <span className="ui-chip ui-chip--warn">No sign-in on this server</span>
          ) : identity?.email !== null && identity?.email !== undefined ? (
            <>
              <Link href="/" className="site-header__link">
                Your films
              </Link>
              <Link href="/account" className="site-header__avatar" aria-label={`Your account (${identity.email})`}>
                <Avatar name={identity.email} size={34} />
              </Link>
            </>
          ) : (
            <Button variant="secondary" asChild className="site-header__signin">
              <Link href="/signin">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
};
