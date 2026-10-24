import Link from "next/link";
import { redirect } from "next/navigation";

import { authConfigured, currentUser, sessionClaims } from "../../src/server/auth.js";
import { listProjects } from "../../src/server/project.js";
import { Avatar, Button, Icon } from "../../src/ui/index.js";
import { AuthShell } from "../AuthShell.js";
import { SignOutButton } from "../SignOutButton.js";

export const metadata = { title: "Your account" };

/**
 * Who you are here, and the few things you can do about it.
 *
 * The header used to carry the address, a Password link and Sign out on
 * every page. They live here now, behind the avatar, which is where people
 * look for them — and the header is left to say where you are.
 */
export default async function AccountPage() {
  if (!authConfigured()) redirect("/");

  const identity = await sessionClaims();

  if (identity === null || identity.email === null) redirect("/signin?next=/account");

  const user = await currentUser();
  const films = user === null ? [] : await listProjects(user.id);

  return (
    <AuthShell title="Your account">
      <div className="account-row" style={{ borderTop: 0, paddingTop: 0 }}>
        <Avatar name={identity.email} size={48} />
        <div className="account-row__text">
          <strong>Signed in</strong>
          <span>{identity.email}</span>
        </div>
      </div>
      <Link href="/" className="account-row" style={{ color: "inherit", textDecoration: "none" }}>
        <Icon name="film" size={22} />
        <span className="account-row__text">
          <strong>Your films</strong>
          <span>{films.length === 1 ? "1 film" : `${String(films.length)} films`}</span>
        </span>
        <Icon name="forward" size={18} />
      </Link>
      <Link href="/account/password" className="account-row" style={{ color: "inherit", textDecoration: "none" }}>
        <Icon name="lock" size={22} />
        <span className="account-row__text">
          <strong>Password</strong>
          <span>Set or change the password you sign in with</span>
        </span>
        <Icon name="forward" size={18} />
      </Link>
      <div className="account-row">
        <SignOutButton block />
      </div>
      <Button variant="quiet" asChild>
        <Link href="/make">Start a new film</Link>
      </Button>
    </AuthShell>
  );
}
